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
  // ผู้ที่เห็นทั้งหมดได้: SuperAdmin/DivAdmin/Director/Deputy/Mayor (เทียบเท่า server.js)
  const seesAll = Auth_isAdmin(session) || Auth_isManager(session)
               || Auth_isDirector(session) || Auth_isDeputy(session) || Auth_isMayor(session);
  const scope = payload.scope || (seesAll ? 'all' : 'mine');

  let rows = DB_findAll(SHEETS.REQUESTS);

  if (scope === 'mine') {
    rows = rows.filter(r => r.requester_id === session.userId);
  }
  // Division scoping: ถ้าไม่ใช่ canSeeAllDivisions (ปลัด/นายก/SuperAdmin) ให้กรองเฉพาะกองตัวเอง
  if (!Auth_canSeeAllDivisions(session) && session.division_id) {
    rows = rows.filter(r => r.division_id === session.division_id || r.requester_id === session.userId);
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
  if (payload.divisionFilter) {
    rows = rows.filter(r => r.division_id === payload.divisionFilter);
  }
  // Filter เพิ่มเติมสำหรับการพิมพ์แบบ 4
  if (payload.vehicleId) rows = rows.filter(r => r.vehicle_id === payload.vehicleId);
  if (payload.driverId)  rows = rows.filter(r => r.driver_id  === payload.driverId);
  if (payload.year && payload.month) {
    const y = Number(payload.year);
    const m = Number(payload.month);
    rows = rows.filter(function(r) {
      if (!r.depart_date) return false;
      const d = new Date(r.depart_date);
      return d.getFullYear() === y && (d.getMonth() + 1) === m;
    });
  }

  // sort: ใหม่สุดก่อน
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return ok(rows);
}

/**
 * Batch ดึงรายละเอียดคำขอสำหรับการพิมพ์แบบ ๓ รายเดือน
 * - input: { vehicleId, year, month }
 * - enforce ขอบเขตกอง (เหมือน Request_list)
 * - return: { items: [{ request, history, trip }, ...] }
 *   ฝั่ง dispatcher จะส่งผ่าน Adapter_requestDetailOut เพื่อเติม vehicle/driver/approvers
 *
 * เปิดให้ทุก role ที่ login ได้ใช้ — server enforce กองอัตโนมัติให้
 * ผู้ที่ไม่ใช่ canSeeAllDivisions
 */
function Request_printBatch(session, payload) {
  payload = payload || {};
  if (!payload.vehicleId) return err('invalid_input', 'กรุณาเลือกหมายเลขทะเบียนรถ');
  if (!payload.year || !payload.month) return err('invalid_input', 'กรุณาระบุเดือน/ปี');
  let rows = DB_findAll(SHEETS.REQUESTS);
  // ขอบเขตกอง: ไม่ใช่ canSeeAllDivisions → กรองเฉพาะกองตัวเอง (+ ของตัวเอง)
  if (!Auth_canSeeAllDivisions(session) && session.division_id) {
    rows = rows.filter(r => r.division_id === session.division_id || r.requester_id === session.userId);
  }
  rows = rows.filter(r => r.vehicle_id === payload.vehicleId);
  const y = Number(payload.year), m = Number(payload.month);
  rows = rows.filter(function(r) {
    if (!r.depart_date) return false;
    const d = new Date(r.depart_date);
    return d.getFullYear() === y && (d.getMonth() + 1) === m;
  });
  // เรียงจากวันที่น้อยไปมาก (parse เป็น Date กัน format ไม่นิ่ง)
  rows.sort(function(a, b) {
    const ta = new Date(a.depart_date).getTime() || 0;
    const tb = new Date(b.depart_date).getTime() || 0;
    if (ta !== tb) return ta - tb;
    return String(a.depart_time || '').localeCompare(String(b.depart_time || ''));
  });
  const items = rows.map(function(r) {
    const history = DB_findAll(SHEETS.APPROVAL_LOGS, { where: { request_id: r.id } });
    history.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const trip = DB_findOne(SHEETS.TRIP_LOGS, { request_id: r.id });
    return { request: r, history: history, trip: trip };
  });
  return ok({ items: items });
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
  if (!payload.vehicle_id) return err('invalid_input', 'กรุณาเลือกรถ');
  if (!payload.driver_id)  return err('invalid_input', 'กรุณาเลือกคนขับ');

  const departAt = Utils_combineDateTime(payload.depart_date, payload.depart_time);
  const returnAt = Utils_combineDateTime(payload.return_date, payload.return_time);
  if (!departAt || !returnAt) return err('invalid_input', 'วันที่/เวลา ไม่ถูกต้อง');
  if (returnAt <= departAt) return err('invalid_range', 'เวลากลับต้องหลังเวลาออก');

  const vehicle = DB_findById(SHEETS.VEHICLES, payload.vehicle_id);
  if (!vehicle) return err('not_found', 'ไม่พบรถที่เลือก');
  if (vehicle.status === VEHICLE_STATUS.RETIRED)     return err('vehicle_retired', 'รถคันนี้ถูกปลดระวาง');
  if (vehicle.status === VEHICLE_STATUS.MAINTENANCE) return err('vehicle_maint', 'รถคันนี้อยู่ระหว่างซ่อมบำรุง');

  const driver = DB_findById(SHEETS.DRIVERS, payload.driver_id);
  if (!driver) return err('not_found', 'ไม่พบคนขับที่เลือก');
  if (driver.status !== 'active') return err('driver_inactive', 'คนขับไม่อยู่ในสถานะใช้งาน');

  const dummy = { id: '', depart_date: payload.depart_date, depart_time: payload.depart_time,
                  return_date: payload.return_date, return_time: payload.return_time };
  const vConflict = _findConflict(vehicle.id, dummy, 'vehicle');
  if (vConflict) return err('conflict_vehicle', 'รถถูกจองอยู่แล้ว: ' + vConflict.request_no + ' (' + (vConflict.depart_date || '') + ')');
  const dConflict = _findConflict(driver.id, dummy, 'driver');
  if (dConflict) return err('conflict_driver', 'คนขับมีงานอยู่แล้ว: ' + dConflict.request_no + ' (' + (dConflict.depart_date || '') + ')');

  const user = DB_findById(SHEETS.USERS, session.userId);
  const requestNo = Utils_genRequestNo();

  const created = DB_insert(SHEETS.REQUESTS, {
    id: Utils_genId(),
    request_no: requestNo,
    requester_id: user.id,
    requester_name: user.fullname,
    department: user.department,
    division_id: user.division_id || '',
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
    vehicle_id: vehicle.id,
    vehicle_plate: vehicle.plate_number,
    driver_id: driver.id,
    driver_name: driver.fullname,
    status: REQUEST_STATUS.PENDING,
    current_level: 1,
    reject_reason: '',
    notes: payload.notes || '',
    created_at: Utils_now(),
    updated_at: Utils_now()
  });

  DB_insert(SHEETS.APPROVAL_LOGS, {
    id: Utils_genId(),
    request_id: created.id,
    approver_id: user.id,
    approver_name: user.fullname,
    approver_role: user.role,
    action: APPROVAL_ACTIONS.SUBMIT,
    level: 0,
    comment: 'ยื่นคำขอใหม่ รถ ' + vehicle.plate_number + ' คนขับ ' + driver.fullname,
    created_at: Utils_now()
  });

  Utils_audit(user.id, user.username, 'request.create', 'request', created.id, { request_no: created.request_no });
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
                   'vehicle_type_pref','phone','notes','vehicle_id','driver_id'];
  const patch = {};
  allowed.forEach(function(k) { if (payload[k] !== undefined) patch[k] = payload[k]; });

  // ตรวจ conflict รถ/คนขับ ถ้ามีการเปลี่ยนแปลง
  const newVehicleId = patch.vehicle_id || r.vehicle_id;
  const newDriverId  = patch.driver_id  || r.driver_id;
  const depDate = patch.depart_date || r.depart_date;
  const depTime = patch.depart_time || r.depart_time;
  const retDate = patch.return_date || r.return_date;
  const retTime = patch.return_time || r.return_time;
  if (newVehicleId) {
    const vehicle = DB_findById(SHEETS.VEHICLES, newVehicleId);
    if (!vehicle) return err('not_found', 'ไม่พบรถที่เลือก');
    if (vehicle.status === VEHICLE_STATUS.RETIRED)     return err('vehicle_retired', 'รถคันนี้ถูกปลดระวาง');
    if (vehicle.status === VEHICLE_STATUS.MAINTENANCE) return err('vehicle_maint', 'รถคันนี้อยู่ระหว่างซ่อมบำรุง');
    const dummy = { id: r.id, depart_date: depDate, depart_time: depTime, return_date: retDate, return_time: retTime };
    const vConflict = _findConflict(vehicle.id, dummy, 'vehicle');
    if (vConflict) return err('conflict_vehicle', 'รถถูกจองอยู่แล้ว: ' + vConflict.request_no);
    patch.vehicle_plate = vehicle.plate_number;
  }
  if (newDriverId) {
    const driver = DB_findById(SHEETS.DRIVERS, newDriverId);
    if (!driver) return err('not_found', 'ไม่พบคนขับที่เลือก');
    if (driver.status !== 'active') return err('driver_inactive', 'คนขับไม่อยู่ในสถานะใช้งาน');
    const dummy = { id: r.id, depart_date: depDate, depart_time: depTime, return_date: retDate, return_time: retTime };
    const dConflict = _findConflict(driver.id, dummy, 'driver');
    if (dConflict) return err('conflict_driver', 'คนขับมีงานอยู่แล้ว: ' + dConflict.request_no);
    patch.driver_name = driver.fullname;
  }

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
  const NON_CANCELLABLE = [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS, REQUEST_STATUS.COMPLETED, REQUEST_STATUS.CANCELLED, REQUEST_STATUS.REJECTED];
  if (NON_CANCELLABLE.indexOf(r.status) >= 0) {
    return err('invalid_status', 'ไม่สามารถยกเลิกคำขอในสถานะนี้ได้ (อนุมัติแล้วหรืออยู่ระหว่างดำเนินการ)');
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
