/**
 * ============================================================================
 *  ApprovalService.gs — Workflow การอนุมัติ
 *  Level 1: หัวหน้าแผนก (approver) — อนุมัติ/ปฏิเสธ
 *  Level 2: ผู้จัดการรถ (manager)  — จัดสรรรถ/คนขับ + อนุมัติ
 * ============================================================================
 */

// ---------- รายการที่รออนุมัติ (สำหรับตนเอง) ----------

function Approval_pendingList(session) {
  let list = [];

  if (Auth_isApprover(session) || Auth_isAdmin(session)) {
    // level 1 — หัวหน้าแผนก
    const pending = DB_findAll(SHEETS.REQUESTS, { where: { status: REQUEST_STATUS.PENDING } });
    pending.forEach(r => r._approval_level = 1);
    list = list.concat(pending);
  }

  if (Auth_isManager(session) || Auth_isAdmin(session)) {
    // level 2 — ผู้จัดการรถ จัดสรร
    const l1 = DB_findAll(SHEETS.REQUESTS, { where: { status: REQUEST_STATUS.APPROVED_L1 } });
    l1.forEach(r => r._approval_level = 2);
    list = list.concat(l1);
  }

  // de-dup
  const seen = {};
  list = list.filter(r => seen[r.id] ? false : (seen[r.id] = true));

  list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return ok(list);
}

// ---------- Approve ----------

/**
 * อนุมัติคำขอ
 * payload: { requestId, comment }
 *  - level 1 (approver) → ส่งต่อเป็น approved_l1
 *  - level 2 (manager)  → ต้องใช้ Approval_assign แทน
 */
function Approval_approve(session, payload) {
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');

  if (r.status === REQUEST_STATUS.PENDING) {
    // Level 1 — หัวหน้าแผนก
    if (!Auth_isApprover(session) && !Auth_isAdmin(session)) {
      return err('forbidden', 'ไม่มีสิทธิ์อนุมัติขั้นนี้');
    }
    DB_update(SHEETS.REQUESTS, r.id, {
      status: REQUEST_STATUS.APPROVED_L1,
      current_level: 2,
      updated_at: Utils_now()
    });
    _logApproval(r.id, session, APPROVAL_ACTIONS.APPROVE, 1, payload.comment);

    // แจ้ง manager ให้จัดสรรรถ
    try { Email_notifyApprovalL1(r); } catch(e){ console.error(e); }
    Utils_audit(session.userId, session.username, 'approval.approve_l1', 'request', r.id, '');
    return ok(true);

  } else if (r.status === REQUEST_STATUS.APPROVED_L1) {
    return err('use_assign', 'ขั้นนี้ต้องใช้การจัดสรรรถ/คนขับ (approval.assign)');
  } else {
    return err('invalid_status', 'สถานะปัจจุบันไม่สามารถอนุมัติได้');
  }
}

// ---------- Reject ----------

function Approval_reject(session, payload) {
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (!payload.comment) return err('invalid_input', 'กรุณาระบุเหตุผลการปฏิเสธ');

  // ตรวจสิทธิ์ตามสถานะ
  const atL1 = r.status === REQUEST_STATUS.PENDING;
  const atL2 = r.status === REQUEST_STATUS.APPROVED_L1;

  if (atL1 && !(Auth_isApprover(session) || Auth_isAdmin(session))) {
    return err('forbidden', 'ไม่มีสิทธิ์ปฏิเสธขั้นนี้');
  }
  if (atL2 && !(Auth_isManager(session) || Auth_isAdmin(session))) {
    return err('forbidden', 'ไม่มีสิทธิ์ปฏิเสธขั้นนี้');
  }
  if (!atL1 && !atL2) {
    return err('invalid_status', 'สถานะปัจจุบันไม่สามารถปฏิเสธได้');
  }

  DB_update(SHEETS.REQUESTS, r.id, {
    status: REQUEST_STATUS.REJECTED,
    reject_reason: payload.comment,
    updated_at: Utils_now()
  });
  _logApproval(r.id, session, APPROVAL_ACTIONS.REJECT, atL1 ? 1 : 2, payload.comment);

  try { Email_notifyRejected(r, payload.comment); } catch(e){ console.error(e); }
  Utils_audit(session.userId, session.username, 'approval.reject', 'request', r.id, payload.comment);
  return ok(true);
}

// ---------- Assign (จัดสรรรถ/คนขับ + อนุมัติขั้น 2) ----------

/**
 * payload: { requestId, vehicleId, driverId, comment }
 */
function Approval_assign(session, payload) {
  if (!Auth_isManager(session) && !Auth_isAdmin(session)) {
    return err('forbidden', 'ต้องเป็นผู้จัดการรถเท่านั้น');
  }
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (r.status !== REQUEST_STATUS.APPROVED_L1) {
    return err('invalid_status', 'จัดสรรได้เฉพาะคำขอสถานะ "รอจัดสรรรถ"');
  }
  if (!payload.vehicleId || !payload.driverId) {
    return err('invalid_input', 'กรุณาเลือกทั้งรถและคนขับ');
  }

  const vehicle = DB_findById(SHEETS.VEHICLES, payload.vehicleId);
  const driver  = DB_findById(SHEETS.DRIVERS,  payload.driverId);
  if (!vehicle) return err('not_found', 'ไม่พบรถที่เลือก');
  if (!driver)  return err('not_found', 'ไม่พบคนขับที่เลือก');
  if (vehicle.status === VEHICLE_STATUS.RETIRED) return err('vehicle_retired', 'รถคันนี้ถูกปลดระวาง');
  if (vehicle.status === VEHICLE_STATUS.MAINTENANCE) return err('vehicle_maint', 'รถคันนี้อยู่ระหว่างซ่อมบำรุง');

  // ตรวจเวลาชน — รถ
  const conflict = _findConflict(vehicle.id, r, 'vehicle');
  if (conflict) return err('conflict_vehicle', 'รถถูกจองอยู่: ' + conflict.request_no + ' (' + Utils_formatDateTimeTH(Utils_combineDateTime(conflict.depart_date, conflict.depart_time)) + ')');

  // ตรวจเวลาชน — คนขับ
  const driverConflict = _findConflict(driver.id, r, 'driver');
  if (driverConflict) return err('conflict_driver', 'คนขับมีงานอยู่แล้ว: ' + driverConflict.request_no);

  DB_update(SHEETS.REQUESTS, r.id, {
    status: REQUEST_STATUS.APPROVED,
    vehicle_id: vehicle.id,
    vehicle_plate: vehicle.plate_number,
    driver_id: driver.id,
    driver_name: driver.fullname,
    current_level: 3,
    updated_at: Utils_now()
  });

  _logApproval(r.id, session, APPROVAL_ACTIONS.ASSIGN, 2,
    'จัดสรรรถ ' + vehicle.plate_number + ' / คนขับ ' + driver.fullname + ' — ' + (payload.comment || ''));

  try { Email_notifyApproved({ ...r, vehicle_plate: vehicle.plate_number, driver_name: driver.fullname }); } catch(e){ console.error(e); }
  Utils_audit(session.userId, session.username, 'approval.assign', 'request', r.id, { vehicle: vehicle.plate_number, driver: driver.fullname });
  return ok(true);
}

// ---------- History ----------

function Approval_history(session, requestId) {
  const rows = DB_findAll(SHEETS.APPROVAL_LOGS, { where: { request_id: requestId } });
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return ok(rows);
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
 * type: 'vehicle' | 'driver'
 */
function _findConflict(resourceId, request, type) {
  const field = type === 'vehicle' ? 'vehicle_id' : 'driver_id';
  const targets = [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS];
  const candidates = DB_findAll(SHEETS.REQUESTS).filter(r =>
    r[field] === resourceId && targets.indexOf(r.status) >= 0 && r.id !== request.id
  );
  if (!candidates.length) return null;

  const myStart = Utils_combineDateTime(request.depart_date, request.depart_time);
  const myEnd   = Utils_combineDateTime(request.return_date, request.return_time);

  for (const c of candidates) {
    const cStart = Utils_combineDateTime(c.depart_date, c.depart_time);
    const cEnd   = Utils_combineDateTime(c.return_date, c.return_time);
    if (Utils_rangesOverlap(myStart, myEnd, cStart, cEnd)) return c;
  }
  return null;
}
