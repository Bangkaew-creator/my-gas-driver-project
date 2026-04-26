/**
 * ============================================================================
 *  Auth.gs — Authentication & Session Management
 *  - Login ด้วย username/password (SHA-256 + salt)
 *  - Session token เก็บใน CacheService (TTL 8 ชม.)
 *  - Role-based permission check
 * ============================================================================
 */

// ---------- Login / Logout ----------

function Auth_login(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username || !password) return err('invalid_input', 'กรุณากรอก username และ password');

  const user = DB_findOne(SHEETS.USERS, { username: username });
  if (!user) return err('invalid_credentials', 'username หรือ password ไม่ถูกต้อง');

  if (user.status !== 'active') {
    return err('user_disabled', 'บัญชีผู้ใช้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ');
  }

  const hash = Utils_hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    return err('invalid_credentials', 'username หรือ password ไม่ถูกต้อง');
  }

  // สร้าง session
  const token = Utils_genToken();
  const session = {
    token: token,
    userId: user.id,
    username: user.username,
    fullname: user.fullname,
    role: user.role,
    department: user.department,
    email: user.email,
    loginAt: Utils_now()
  };
  CacheService.getScriptCache().put(
    SESSION.CACHE_PREFIX + token,
    JSON.stringify(session),
    SESSION.TTL_SECONDS
  );

  Utils_audit(user.id, user.username, 'login', 'user', user.id, '');

  return ok({
    token: token,
    user: Utils_stripUser(user),
    session: session,
    roleLabel: ROLE_LABELS[user.role] || user.role
  });
}

function Auth_logout(token) {
  if (token) CacheService.getScriptCache().remove(SESSION.CACHE_PREFIX + token);
  return ok(true);
}

// ---------- Session ----------

/**
 * ตรวจ token → คืน session object หรือ null
 */
function Auth_getSession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(SESSION.CACHE_PREFIX + token);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    // refresh TTL
    CacheService.getScriptCache().put(
      SESSION.CACHE_PREFIX + token,
      raw,
      SESSION.TTL_SECONDS
    );
    return s;
  } catch (e) { return null; }
}

function Auth_getMe(session) {
  const user = DB_findById(SHEETS.USERS, session.userId);
  return {
    user: Utils_stripUser(user),
    session: session,
    roleLabel: ROLE_LABELS[session.role] || session.role
  };
}

// ---------- Password ----------

function Auth_changePassword(session, oldPass, newPass) {
  if (!oldPass || !newPass) return err('invalid_input', 'กรุณากรอกข้อมูลให้ครบ');
  if (String(newPass).length < 8) return err('weak_password', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');

  const user = DB_findById(SHEETS.USERS, session.userId);
  if (!user) return err('not_found', 'ไม่พบบัญชีผู้ใช้');

  if (Utils_hashPassword(oldPass, user.salt) !== user.password_hash) {
    return err('invalid_credentials', 'รหัสผ่านเดิมไม่ถูกต้อง');
  }

  const newSalt = Utils_genSalt();
  DB_update(SHEETS.USERS, user.id, {
    salt: newSalt,
    password_hash: Utils_hashPassword(newPass, newSalt),
    updated_at: Utils_now()
  });
  Utils_audit(user.id, user.username, 'change_password', 'user', user.id, '');
  return ok(true);
}

// ---------- Role check helpers ----------

function Auth_hasRole(session, roles) {
  if (!session) return false;
  if (typeof roles === 'string') roles = [roles];
  return roles.indexOf(session.role) >= 0;
}

function Auth_requireRole(session, roles) {
  if (!Auth_hasRole(session, roles)) {
    throw new Error('สิทธิ์ไม่เพียงพอ (ต้องการบทบาท: ' + (Array.isArray(roles) ? roles.join(', ') : roles) + ')');
  }
}

function Auth_isAdmin(session)    { return session && session.role === ROLES.ADMIN; }
function Auth_isManager(session)  { return session && (session.role === ROLES.MANAGER || session.role === ROLES.ADMIN); }
function Auth_isApprover(session) { return session && (session.role === ROLES.APPROVER || session.role === ROLES.ADMIN); }
function Auth_isDriver(session)   { return session && session.role === ROLES.DRIVER; }
