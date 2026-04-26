/**
 * ============================================================================
 *  RequestService.gs — ตรรกะทางธุรกิจของ "คำขอใช้รถ"
 * ============================================================================
 */

// ---------- List / Get ----------

/**
 * ดึงรายการคำขอ
 * payload: { status?, from?, to?, departmentFilter?, scope? }
 *  - scope: 'mine' = เฉพาะของฉัน, 'all' = ทั้งหมด (เฉพาะ admin/manager)
 */
function Request_list(session, payload) {
  payload = payload || {};
  const scope = payload.scope || (Auth_isAdmin(session) || Auth_isManager(session) ? 'all' : 'mine');

  let rows = DB_findAll(SHEETS.REQUESTS);

  if (scope === 'mine') {
    rows = rows.filter(r => r.requester_id === session.userId);
  }

  if (payload.status) {
    const statuses = Array.isArray(payload.status) ? payload.status : [payload.status];
    rows = rows.filter(r => statuses.indexOf(r.status) >= 0);
  }

  if (payload.from) {
    const from = new Date(payload.from);
    rows = rows.filter(r => r.depart_date && new Date(r.depart_date) >= from);
  }
  if (payload.to) {
    const to = new Date(payload.to);
    rows = rows.filter(r => r.depart_date && new Date(r.depart_date) <= to);
  }

  if (payload.departmentFilter) {
    rows = rows.filter(r => r.department === payload.departmentFilter);
  }

  // sort: ใหม่สุดก่อน
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return ok(rows);
}

function Request_get(session, id) {
  const r = DB_findById(SHEETS.REQUESTS, id);
  if (!r) return err('not_found', 'ไม่พบคำขอ');

  // เจ้าของ / admin / manager / approver เท่านั้นดูได้
  const isOwner = r.requester_id === session.userId;
  if (!isOwner && !Auth_isAdmin(session) && !Auth_isManager(session) && !Auth_isApprover(session) && !Auth_isDriver(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์ดูคำขอนี้');
  }
  // driver ดูได้เฉพาะที่ assign ให้ตนเอง
  if (Auth_isDriver(session) && !isOwner) {
    const me = DB_findOne(SHEETS.DRIVERS, { email: session.email });
    if (!me || r.driver_id !== me.id) return err('forbidden', 'ไม่มีสิทธิ์ดูคำขอนี้');
  }

  const history = DB_findAll(SHEETS.APPROVAL_LOGS, { where: { request_id: id } });
  history.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const trip = DB_findOne(SHEETS.TRIP_LOGS, { request_id: id });

  return ok({ request: r, history: history, trip: trip });
}

// ---------- Create ----------

/**
 * สร้างคำขอใหม่
 * payload ต้องมี: purpose, destination, depart_date, depart_time, return_date, return_time, passengers_count
 */
function Request_create(session, payload) {
  const missing = Utils_required(payload, [
    'purpose','destination','depart_date','depart_time','return_date','return_time','passengers_count'
  ]);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  const departAt = Utils_combineDateTime(payload.depart_date, payload.depart_time);
  const returnAt = Utils_combineDateTime(payload.return_date, payload.return_time);
  if (!departAt || !returnAt) return err('invalid_input', 'วันที่/เวลา ไม่ถูกต้อง');
  if (returnAt <= departAt) return err('invalid_range', 'เวลากลับต้องหลังเวลาออก');

  const user = DB_findById(SHEETS.USERS, session.userId);
  const requestNo = Utils_genRequestNo();

  const created = DB_insert(SHEETS.REQUESTS, {
    id: Utils_genId(),
    request_no: requestNo,
    requester_id: user.id,
    requester_name: user.fullname,
    department: user.department,
    position: user.position,
    phone: payload.phone || user.phone || '',
    purpose: payload.purpose,
    destination: payload.destination,
    passengers_count: Number(payload.passengers_count) || 1,
    passenger_list: payload.passenger_list || '',
    depart_date: payload.depart_date,
    depart_time: payload.depart_time,
    return_date: payload.return_date,
    return_time: payload.return_time,
    vehicle_type_pref: payload.vehicle_type_pref || '',
    vehicle_id: '',
    vehicle_plate: '',
    driver_id: '',
    driver_name: '',
    status: REQUEST_STATUS.PENDING,
    current_level: 1,
    reject_reason: '',
    notes: payload.notes || '',
    created_at: Utils_now(),
    updated_at: Utils_now()
  });

  // บันทึก approval log (submit)
  DB_insert(SHEETS.APPROVAL_LOGS, {
    id: Utils_genId(),
    request_id: created.id,
    approver_id: user.id,
    approver_name: user.fullname,
    approver_role: user.role,
    action: APPROVAL_ACTIONS.SUBMIT,
    level: 0,
    comment: 'ยื่นคำขอใหม่',
    created_at: Utils_now()
  });

  Utils_audit(user.id, user.username, 'request.create', 'request', created.id, { request_no: created.request_no });

  // แจ้งเตือนหัวหน้าแผนก / admin
  try { Email_notifyNewRequest(created); } catch (e) { console.error('email fail', e); }

  return ok(created);
}

// ---------- Update ----------

function Request_update(session, payload) {
  const r = DB_findById(SHEETS.REQUESTS, payload.id);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (r.requester_id !== session.userId && !Auth_isAdmin(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์แก้ไขคำขอนี้');
  }
  if (r.status !== REQUEST_STATUS.PENDING) {
    return err('invalid_status', 'แก้ไขได้เฉพาะคำขอที่ยัง "รออนุมัติขั้น 1"');
  }

  const allowed = ['purpose','destination','passengers_count','passenger_list',
                   'depart_date','depart_time','return_date','return_time',
                   'vehicle_type_pref','phone','notes'];
  const patch = {};
  allowed.forEach(k => { if (payload[k] !== undefined) patch[k] = payload[k]; });
  patch.updated_at = Utils_now();

  const updated = DB_update(SHEETS.REQUESTS, r.id, patch);
  Utils_audit(session.userId, session.username, 'request.update', 'request', r.id, patch);
  return ok(updated);
}

// ---------- Cancel ----------

function Request_cancel(session, id, reason) {
  const r = DB_findById(SHEETS.REQUESTS, id);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (r.requester_id !== session.userId && !Auth_isAdmin(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์ยกเลิกคำขอนี้');
  }
  if ([REQUEST_STATUS.COMPLETED, REQUEST_STATUS.CANCELLED, REQUEST_STATUS.REJECTED].indexOf(r.status) >= 0) {
    return err('invalid_status', 'ไม่สามารถยกเลิกคำขอในสถานะนี้ได้');
  }

  DB_update(SHEETS.REQUESTS, id, { status: REQUEST_STATUS.CANCELLED, reject_reason: reason || '', updated_at: Utils_now() });

  // ถ้าเคย assign รถ ให้คืนสถานะรถ
  if (r.vehicle_id) {
    DB_update(SHEETS.VEHICLES, r.vehicle_id, { status: VEHICLE_STATUS.AVAILABLE });
  }

  DB_insert(SHEETS.APPROVAL_LOGS, {
    id: Utils_genId(),
    request_id: id,
    approver_id: session.userId,
    approver_name: session.fullname,
    approver_role: session.role,
    action: APPROVAL_ACTIONS.CANCEL,
    level: r.current_level,
    comment: reason || 'ยกเลิกโดยผู้ขอ',
    created_at: Utils_now()
  });

  Utils_audit(session.userId, session.username, 'request.cancel', 'request', id, { reason: reason });
  return ok(true);
}

// ---------- My Inbox (รวมที่เกี่ยวข้องกับฉัน) ----------

function Request_myInbox(session) {
  const all = DB_findAll(SHEETS.REQUESTS);
  const mine = all.filter(r => r.requester_id === session.userId);
  mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return ok(mine);
}
