/**
 * ============================================================================
 *  ApprovalService.gs — Workflow การอนุมัติ 3 ขั้น
 *  Level 1: ผอ.กอง (director)  — PENDING → APPROVED_L1
 *  Level 2: ปลัด (deputy)      — APPROVED_L1 → APPROVED_L2
 *  Level 3: นายก (mayor)       — APPROVED_L2 → APPROVED (ไม่มีขั้นตอนจัดสรร เลือกรถ/คนขับตอนยื่น)
 * ============================================================================
 */

// ---------- รายการที่รออนุมัติ (สำหรับตนเอง) ----------

function Approval_pendingList(session) {
  let list = [];

  // L1 — ผอ.กอง เห็น PENDING ของกองตัวเอง; super_admin เห็นทุกกอง
  if (Auth_isDirector(session) || Auth_isAdmin(session)) {
    let rows = DB_findAll(SHEETS.REQUESTS, { where: { status: REQUEST_STATUS.PENDING } });
    if (Auth_isDirector(session) && !Auth_isAdmin(session) && session.division_id) {
      rows = rows.filter(function(r) { return r.division_id === session.division_id; });
    }
    rows.forEach(function(r) { r._approval_level = 1; });
    list = list.concat(rows);
  }

  // L2 — ปลัด เห็น APPROVED_L1 ทุกกอง
  if (Auth_isDeputy(session) || Auth_isAdmin(session)) {
    const rows = DB_findAll(SHEETS.REQUESTS, { where: { status: REQUEST_STATUS.APPROVED_L1 } });
    rows.forEach(function(r) { r._approval_level = 2; });
    list = list.concat(rows);
  }

  // L3 — นายก เห็น APPROVED_L2 ทุกกอง
  if (Auth_isMayor(session) || Auth_isAdmin(session)) {
    const rows = DB_findAll(SHEETS.REQUESTS, { where: { status: REQUEST_STATUS.APPROVED_L2 } });
    rows.forEach(function(r) { r._approval_level = 3; });
    list = list.concat(rows);
  }

  // de-dup (super_admin อาจอยู่หลาย branch)
  const seen = {};
  list = list.filter(function(r) { return seen[r.id] ? false : (seen[r.id] = true); });
  list.sort(function(a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  return ok(list);
}

// ---------- Approve ----------

/**
 * อนุมัติคำขอ
 * payload: { requestId, comment }
 *  - level 1 (director/admin)  PENDING     → APPROVED_L1
 *  - level 2 (deputy/admin)    APPROVED_L1 → APPROVED_L2
 *  - level 3 (mayor/admin)     APPROVED_L2 → APPROVED
 */
function Approval_approve(session, payload) {
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');

  if (r.status === REQUEST_STATUS.PENDING) {
    if (!Auth_isDirector(session) && !Auth_isAdmin(session)) {
      return err('forbidden', 'เฉพาะ ผอ.กอง หรือผู้ดูแลระบบ');
    }
    if (Auth_isDirector(session) && !Auth_isAdmin(session) && session.division_id && r.division_id && r.division_id !== session.division_id) {
      return err('forbidden', 'ไม่มีสิทธิ์อนุมัติคำขอของกองอื่น');
    }
    DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.APPROVED_L1, current_level: 2, updated_at: Utils_now() });
    _logApproval(r.id, session, APPROVAL_ACTIONS.APPROVE, 1, payload.comment);
    Utils_audit(session.userId, session.username, 'approval.approve_l1', 'request', r.id, '');
    return ok(true);
  }

  if (r.status === REQUEST_STATUS.APPROVED_L1) {
    if (!Auth_isDeputy(session) && !Auth_isAdmin(session)) {
      return err('forbidden', 'เฉพาะปลัดเทศบาล หรือผู้ดูแลระบบ');
    }
    DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.APPROVED_L2, current_level: 3, updated_at: Utils_now() });
    _logApproval(r.id, session, APPROVAL_ACTIONS.APPROVE, 2, payload.comment);
    Utils_audit(session.userId, session.username, 'approval.approve_l2', 'request', r.id, '');
    return ok(true);
  }

  if (r.status === REQUEST_STATUS.APPROVED_L2) {
    if (!Auth_isMayor(session) && !Auth_isAdmin(session)) {
      return err('forbidden', 'เฉพาะนายกเทศมนตรี หรือผู้ดูแลระบบ');
    }
    DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.APPROVED, current_level: 4, updated_at: Utils_now() });
    _logApproval(r.id, session, APPROVAL_ACTIONS.APPROVE, 3, payload.comment);
    try { Email_notifyApproved(r); } catch(e) { console.error(e); }
    Utils_audit(session.userId, session.username, 'approval.approve_l3', 'request', r.id, '');
    return ok(true);
  }

  return err('invalid_status', 'สถานะปัจจุบันไม่สามารถอนุมัติได้');
}

// ---------- Reject ----------

function Approval_reject(session, payload) {
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (!payload.comment) return err('invalid_input', 'กรุณาระบุเหตุผลการปฏิเสธ');

  const REJECTABLE = [REQUEST_STATUS.PENDING, REQUEST_STATUS.APPROVED_L1, REQUEST_STATUS.APPROVED_L2];
  if (REJECTABLE.indexOf(r.status) < 0) return err('invalid_status', 'สถานะปัจจุบันไม่สามารถปฏิเสธได้');

  if (r.status === REQUEST_STATUS.PENDING    && !Auth_isDirector(session) && !Auth_isAdmin(session)) return err('forbidden', 'ไม่มีสิทธิ์ปฏิเสธขั้นนี้');
  if (r.status === REQUEST_STATUS.APPROVED_L1 && !Auth_isDeputy(session)  && !Auth_isAdmin(session)) return err('forbidden', 'ไม่มีสิทธิ์ปฏิเสธขั้นนี้');
  if (r.status === REQUEST_STATUS.APPROVED_L2 && !Auth_isMayor(session)   && !Auth_isAdmin(session)) return err('forbidden', 'ไม่มีสิทธิ์ปฏิเสธขั้นนี้');

  const levelMap = {};
  levelMap[REQUEST_STATUS.PENDING]     = 1;
  levelMap[REQUEST_STATUS.APPROVED_L1] = 2;
  levelMap[REQUEST_STATUS.APPROVED_L2] = 3;

  DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.REJECTED, reject_reason: payload.comment, updated_at: Utils_now() });
  _logApproval(r.id, session, APPROVAL_ACTIONS.REJECT, levelMap[r.status] || 1, payload.comment);
  try { Email_notifyRejected(r, payload.comment); } catch(e) { console.error(e); }
  Utils_audit(session.userId, session.username, 'approval.reject', 'request', r.id, payload.comment);
  return ok(true);
}

// ---------- Assign — deprecated ----------

function Approval_assign() {
  return err('deprecated', 'การจัดสรรรถถูกย้ายไปยังขั้นตอนยื่นคำขอแล้ว');
}

// ---------- History ----------

function Approval_history(session, requestId) {
  const rows = DB_findAll(SHEETS.APPROVAL_LOGS, { where: { request_id: requestId } });
  rows.sort(function(a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  return ok(rows);
}

// ---------- Role hint ----------

function Approval_roleHint(session) {
  const parts = [];
  if (Auth_isDirector(session))   parts.push('ผู้อนุมัติชั้น 1 (ผอ.กอง)');
  if (Auth_isDeputy(session))     parts.push('ผู้อนุมัติชั้น 2 (ปลัด)');
  if (Auth_isMayor(session))      parts.push('ผู้อนุมัติชั้น 3 (นายก)');
  if (Auth_isAdmin(session))      parts.push('ผู้ดูแลระบบ (อนุมัติได้ทุกขั้น)');
  return parts.join(' / ');
}

// ---------- Internal ----------

function _logApproval(requestId, session, action, level, comment) {
  DB_insert(SHEETS.APPROVAL_LOGS, {
    id: Utils_genId(),
    request_id: requestId,
    approver_id: session.userId,
    approver_name: session.fullname,
    approver_role: session.role,
    action: action,
    level: level,
    comment: comment || '',
    created_at: Utils_now()
  });
}

/**
 * ตรวจหา conflict (รถ หรือ คนขับ ถูกใช้อยู่ในช่วงเวลาเดียวกัน)
 * ครอบคลุม PENDING/L1/L2 + APPROVED + IN_PROGRESS (เลือกรถ/คนขับตั้งแต่ยื่น)
 * type: 'vehicle' | 'driver'
 */
function _findConflict(resourceId, request, type) {
  const field = type === 'vehicle' ? 'vehicle_id' : 'driver_id';
  const BLOCK = [REQUEST_STATUS.PENDING, REQUEST_STATUS.APPROVED_L1, REQUEST_STATUS.APPROVED_L2,
                 REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS];
  const candidates = DB_findAll(SHEETS.REQUESTS).filter(function(r) {
    return r[field] === resourceId && BLOCK.indexOf(r.status) >= 0 && r.id !== request.id;
  });
  if (!candidates.length) return null;

  const myStart = Utils_combineDateTime(request.depart_date, request.depart_time);
  const myEnd   = Utils_combineDateTime(request.return_date, request.return_time);

  for (var i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cStart = Utils_combineDateTime(c.depart_date, c.depart_time);
    const cEnd   = Utils_combineDateTime(c.return_date, c.return_time);
    if (cStart && cEnd && Utils_rangesOverlap(myStart, myEnd, cStart, cEnd)) return c;
  }
  return null;
}
