/**
 * ============================================================================
 *  Auth.gs — Authentication & Session Management
 *  - Login ด้วย username/password (SHA-256 + salt)
 *  - Session token เก็บใน CacheService (TTL 8 ชม.)
 *  - Role-based permission check + Division scoping
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

  // ดึงชื่อกอง (สำหรับแสดงใน session)
  let divisionName = '';
  if (user.division_id) {
    const d = DB_findById(SHEETS.DIVISIONS, user.division_id);
    if (d) divisionName = d.name;
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
    division_id: user.division_id || '',
    division_name: divisionName,
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

// ---------- 7 บทบาทใหม่ ----------
function Auth_isSuperAdmin(session) { return !!(session && session.role === ROLES.SUPER_ADMIN); }
function Auth_isDivAdmin(session)   { return !!(session && session.role === ROLES.DIV_ADMIN); }
function Auth_isDirector(session)   { return !!(session && session.role === ROLES.DIRECTOR); }
function Auth_isDeputy(session)     { return !!(session && session.role === ROLES.DEPUTY); }
function Auth_isMayor(session)      { return !!(session && session.role === ROLES.MAYOR); }
function Auth_isDriver(session)     { return !!(session && session.role === ROLES.DRIVER); }
function Auth_isRequester(session)  { return !!(session && session.role === ROLES.REQUESTER); }

// ---------- Legacy aliases (รักษา semantic เดิม) ----------
// isAdmin    → SuperAdmin
// isManager  → "ผู้จัดการข้อมูล" = SuperAdmin หรือ DivAdmin
// isApprover → "ผู้อนุมัติขั้น 1" = SuperAdmin หรือ Director
function Auth_isAdmin(session)    { return Auth_isSuperAdmin(session); }
function Auth_isManager(session)  { return Auth_isSuperAdmin(session) || Auth_isDivAdmin(session); }
function Auth_isApprover(session) { return Auth_isSuperAdmin(session) || Auth_isDirector(session); }

// ---------- Division scoping helpers ----------
/**
 * เห็นข้อมูลทุกกอง? (SuperAdmin, ปลัด, นายก)
 */
function Auth_canSeeAllDivisions(session) {
  return Auth_isSuperAdmin(session) || Auth_isDeputy(session) || Auth_isMayor(session);
}

/**
 * เห็นข้อมูลของกอง divId? (เห็นทุกกอง หรือ อยู่กองเดียวกัน)
 */
function Auth_canSeeDivision(session, divId) {
  if (Auth_canSeeAllDivisions(session)) return true;
  if (!session || !divId) return false;
  return session.division_id === divId;
}

/**
 * จัดการ (เพิ่ม/แก้/ลบ) ข้อมูลของกอง divId? (SuperAdmin = ทุกกอง, DivAdmin = เฉพาะกองตัวเอง)
 */
function Auth_canManageDivision(session, divId) {
  if (Auth_isSuperAdmin(session)) return true;
  if (Auth_isDivAdmin(session) && session.division_id && session.division_id === divId) return true;
  return false;
}
