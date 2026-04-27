/**
 * ============================================================================
 *  VehicleService.gs — จัดการรถ, คนขับ, trip log, fuel log, maintenance log
 * ============================================================================
 */

// ============================================================
//  VEHICLES
// ============================================================

function Vehicle_list(session, payload) {
  payload = payload || {};
  let rows = DB_findAll(SHEETS.VEHICLES);
  if (payload.status) rows = rows.filter(v => v.status === payload.status);
  if (payload.type)   rows = rows.filter(v => v.type === payload.type);
  rows.sort((a,b) => String(a.plate_number).localeCompare(String(b.plate_number)));
  return ok(rows);
}

function Vehicle_get(session, id) {
  const v = DB_findById(SHEETS.VEHICLES, id);
  if (!v) return err('not_found', 'ไม่พบรถ');
  return ok(v);
}

function Vehicle_save(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  const required = ['plate_number','brand','model','type','seats'];
  const missing = Utils_required(payload, required);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  if (payload.id) {
    // update
    const existing = DB_findById(SHEETS.VEHICLES, payload.id);
    if (!existing) return err('not_found', 'ไม่พบรถ');
    const updated = DB_update(SHEETS.VEHICLES, payload.id, {
      plate_number: payload.plate_number,
      brand: payload.brand,
      model: payload.model,
      year: payload.year || existing.year,
      type: payload.type,
      seats: Number(payload.seats),
      color: payload.color || '',
      fuel_type: payload.fuel_type || '',
      current_mileage: Number(payload.current_mileage) || 0,
      status: payload.status || existing.status,
      notes: payload.notes || '',
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'vehicle.update', 'vehicle', payload.id, '');
    return ok(updated);
  } else {
    // create — กำหนด division_id: DivAdmin ผูกกองตัวเอง, อื่นๆ ตาม payload หรือ session
    const newDivId = Auth_isDivAdmin(session)
      ? (session.division_id || '')
      : (payload.division_id || session.division_id || '');
    const created = DB_insert(SHEETS.VEHICLES, {
      id: Utils_genId(),
      plate_number: payload.plate_number,
      brand: payload.brand,
      model: payload.model,
      year: payload.year || new Date().getFullYear(),
      type: payload.type,
      seats: Number(payload.seats),
      color: payload.color || '',
      fuel_type: payload.fuel_type || '',
      current_mileage: Number(payload.current_mileage) || 0,
      division_id: newDivId,
      status: payload.status || VEHICLE_STATUS.AVAILABLE,
      notes: payload.notes || '',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'vehicle.create', 'vehicle', created.id, '');
    return ok(created);
  }
}

function Vehicle_delete(session, id) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบเท่านั้น');
  // กันลบถ้ามีคำขอที่ยัง active
  const active = DB_findAll(SHEETS.REQUESTS).filter(r =>
    r.vehicle_id === id && [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS].indexOf(r.status) >= 0
  );
  if (active.length) return err('in_use', 'ไม่สามารถลบรถที่กำลังมีคำขอใช้งานอยู่');
  DB_delete(SHEETS.VEHICLES, id);
  Utils_audit(session.userId, session.username, 'vehicle.delete', 'vehicle', id, '');
  return ok(true);
}

/**
 * คืนรถที่ว่างในช่วงเวลาที่ระบุ (legacy — คง contract เดิมไว้)
 *  เปลี่ยน logic: status "in_use" ก็คืนด้วย หาก ณ ช่วงที่ขอไม่ได้ถูกจองอยู่
 *  (เดิมกรองเฉพาะ available → บางเคสรถที่กำลังเดินทางอยู่แต่กลับทันเวลาก็ไม่ปรากฏ)
 * payload: { depart_date, depart_time, return_date, return_time, type? }
 */
function Vehicle_availableOn(session, payload) {
  const start = Utils_combineDateTime(payload.depart_date, payload.depart_time);
  const end   = Utils_combineDateTime(payload.return_date, payload.return_time);
  if (!start || !end) return err('invalid_input', 'ช่วงเวลาไม่ถูกต้อง');

  const exclude = payload.excludeRequestId || '';
  // Exclude only hard-unavailable statuses (retired / maintenance)
  let vehicles = DB_findAll(SHEETS.VEHICLES).filter(v =>
    v.status !== VEHICLE_STATUS.RETIRED && v.status !== VEHICLE_STATUS.MAINTENANCE
  );
  // Division scoping: กรองเฉพาะรถของกองตัวเอง (และรถที่ไม่ผูกกอง)
  if (!Auth_canSeeAllDivisions(session) && session && session.division_id) {
    vehicles = vehicles.filter(function(v) { return !v.division_id || v.division_id === session.division_id; });
  }
  if (payload.type) vehicles = vehicles.filter(v => v.type === payload.type);

  // conflict check — block only if another booking overlaps
  const active = DB_findAll(SHEETS.REQUESTS).filter(r =>
    [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS, REQUEST_STATUS.APPROVED_L1].indexOf(r.status) >= 0 &&
    r.id !== exclude
  );
  const busyIds = {};
  active.forEach(r => {
    if (!r.vehicle_id) return;
    const rs = Utils_combineDateTime(r.depart_date, r.depart_time);
    const re = Utils_combineDateTime(r.return_date, r.return_time);
    if (rs && re && Utils_rangesOverlap(start, end, rs, re)) busyIds[r.vehicle_id] = true;
  });

  const available = vehicles.filter(v => !busyIds[v.id]);
  return ok(available);
}

/**
 * ตรวจความพร้อมใช้งานแบบละเอียด — คืน "ทุกคัน" พร้อม metadata
 *  ใช้ในหน้าจัดรถ/คนขับ เพื่อให้ผู้จัดการรู้ว่าคันไหนชนและชนกับคำขอไหน
 * payload: { depart_date, depart_time, return_date, return_time, min_seats?, excludeRequestId? }
 */
function Vehicle_availabilityCheck(session, payload) {
  const start = Utils_combineDateTime(payload.depart_date, payload.depart_time);
  const end   = Utils_combineDateTime(payload.return_date, payload.return_time);
  if (!start || !end) return err('invalid_input', 'ช่วงเวลาไม่ถูกต้อง');

  const exclude  = payload.excludeRequestId || '';
  const minSeats = Number(payload.min_seats || 0);
  let vehicles = DB_findAll(SHEETS.VEHICLES);
  // Division scoping: กรองเฉพาะรถของกองตัวเอง (และรถที่ไม่ผูกกอง)
  if (!Auth_canSeeAllDivisions(session) && session && session.division_id) {
    vehicles = vehicles.filter(function(v) { return !v.division_id || v.division_id === session.division_id; });
  }

  const activeReqs = DB_findAll(SHEETS.REQUESTS).filter(r =>
    [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS, REQUEST_STATUS.APPROVED_L1].indexOf(r.status) >= 0 &&
    r.id !== exclude && r.vehicle_id
  );
  const reqByVehicle = {};
  activeReqs.forEach(r => {
    (reqByVehicle[r.vehicle_id] = reqByVehicle[r.vehicle_id] || []).push(r);
  });

  const out = vehicles.map(v => {
    const reasons = [];
    if (v.status === VEHICLE_STATUS.RETIRED)     reasons.push({ code: 'retired',     label: 'ปลดระวาง' });
    if (v.status === VEHICLE_STATUS.MAINTENANCE) reasons.push({ code: 'maintenance', label: 'ซ่อมบำรุง' });
    if (minSeats > 0 && (Number(v.seats) || 0) < minSeats) {
      reasons.push({ code: 'seats', label: 'ที่นั่งไม่พอ (มี ' + (v.seats || 0) + ' / ต้องการ ' + minSeats + ')' });
    }

    const conflicts = [];
    (reqByVehicle[v.id] || []).forEach(r => {
      const rs = Utils_combineDateTime(r.depart_date, r.depart_time);
      const re = Utils_combineDateTime(r.return_date, r.return_time);
      if (rs && re && Utils_rangesOverlap(start, end, rs, re)) {
        conflicts.push({
          request_no: r.request_no,
          requester_name: r.requester_name,
          purpose: r.purpose,
          depart_date: r.depart_date, depart_time: r.depart_time,
          return_date: r.return_date, return_time: r.return_time,
          start_iso: rs.toISOString(),
          end_iso:   re.toISOString(),
          status: r.status
        });
      }
    });
    if (conflicts.length) reasons.push({ code: 'conflict', label: 'ชนเวลา (' + conflicts.length + ' คำขอ)' });

    const base = Adapter_vehicleOut(v);
    base.available  = reasons.length === 0;
    base.reasons    = reasons;
    base.conflicts  = conflicts;
    return base;
  });

  return ok(out);
}

/**
 * ตารางการใช้รถ — รายการจองของรถแต่ละคันในช่วงที่กำหนด
 * payload: { from: 'yyyy-MM-dd', to: 'yyyy-MM-dd' }
 */
function Vehicle_schedule(session, payload) {
  payload = payload || {};
  // Default range: today → +30 days
  const now = new Date();
  const defFrom = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const plus30 = new Date(now.getTime() + 30 * 86400000);
  const defTo   = Utilities.formatDate(plus30, 'Asia/Bangkok', 'yyyy-MM-dd');
  const fromStr = payload.from || defFrom;
  const toStr   = payload.to   || defTo;
  const fromD = new Date(fromStr + 'T00:00:00+07:00');
  const toD   = new Date(toStr   + 'T23:59:59+07:00');
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) return err('invalid_input', 'วันที่ไม่ถูกต้อง');

  const vehicles = DB_findAll(SHEETS.VEHICLES).filter(v => v.status !== VEHICLE_STATUS.RETIRED);
  const reqs = DB_findAll(SHEETS.REQUESTS).filter(r =>
    [REQUEST_STATUS.APPROVED_L1, REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS].indexOf(r.status) >= 0 &&
    r.vehicle_id
  );

  const byVehicle = {};
  reqs.forEach(r => {
    const rs = Utils_combineDateTime(r.depart_date, r.depart_time);
    const re = Utils_combineDateTime(r.return_date, r.return_time);
    if (!rs || !re) return;
    if (!Utils_rangesOverlap(fromD, toD, rs, re)) return;
    (byVehicle[r.vehicle_id] = byVehicle[r.vehicle_id] || []).push({
      request_id:     r.id,
      request_no:     r.request_no,
      requester_name: r.requester_name,
      department:     r.department,
      purpose:        r.purpose,
      destination:    r.destination,
      start_iso:      rs.toISOString(),
      end_iso:        re.toISOString(),
      status:         r.status
    });
  });

  // sort each vehicle's bookings by start
  Object.keys(byVehicle).forEach(k => {
    byVehicle[k].sort((a, b) => String(a.start_iso).localeCompare(String(b.start_iso)));
  });

  vehicles.sort((a, b) => String(a.plate_number).localeCompare(String(b.plate_number)));

  return ok({
    range: { from: fromStr, to: toStr },
    vehicles: vehicles.map(v => Object.assign({}, Adapter_vehicleOut(v), {
      bookings: byVehicle[v.id] || []
    }))
  });
}

// ============================================================
//  DRIVERS
// ============================================================

function Driver_list(session, payload) {
  payload = payload || {};
  let rows = DB_findAll(SHEETS.DRIVERS);
  if (payload.status) rows = rows.filter(d => d.status === payload.status);
  rows.sort((a,b) => String(a.fullname).localeCompare(String(b.fullname)));
  return ok(rows);
}

function Driver_get(session, id) {
  const d = DB_findById(SHEETS.DRIVERS, id);
  if (!d) return err('not_found', 'ไม่พบคนขับ');
  return ok(d);
}

function Driver_save(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  const missing = Utils_required(payload, ['fullname','license_number']);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  if (payload.id) {
    const existing = DB_findById(SHEETS.DRIVERS, payload.id);
    if (!existing) return err('not_found', 'ไม่พบคนขับ');
    const updated = DB_update(SHEETS.DRIVERS, payload.id, {
      employee_code: payload.employee_code || existing.employee_code,
      fullname: payload.fullname,
      license_number: payload.license_number,
      license_expiry: payload.license_expiry || '',
      phone: payload.phone || '',
      email: payload.email || '',
      status: payload.status || existing.status,
      notes: payload.notes || '',
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'driver.update', 'driver', payload.id, '');
    return ok(updated);
  } else {
    // create — กำหนด division_id: DivAdmin ผูกกองตัวเอง, อื่นๆ ตาม payload หรือ session
    const newDivId = Auth_isDivAdmin(session)
      ? (session.division_id || '')
      : (payload.division_id || session.division_id || '');
    const created = DB_insert(SHEETS.DRIVERS, {
      id: Utils_genId(),
      employee_code: payload.employee_code || '',
      fullname: payload.fullname,
      license_number: payload.license_number,
      license_expiry: payload.license_expiry || '',
      phone: payload.phone || '',
      email: payload.email || '',
      division_id: newDivId,
      status: payload.status || 'active',
      notes: payload.notes || '',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'driver.create', 'driver', created.id, '');
    return ok(created);
  }
}

function Driver_delete(session, id) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบเท่านั้น');
  const active = DB_findAll(SHEETS.REQUESTS).filter(r =>
    r.driver_id === id && [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS].indexOf(r.status) >= 0
  );
  if (active.length) return err('in_use', 'ไม่สามารถลบคนขับที่มีงานอยู่');
  DB_delete(SHEETS.DRIVERS, id);
  Utils_audit(session.userId, session.username, 'driver.delete', 'driver', id, '');
  return ok(true);
}

// ============================================================
//  TRIP LOG
// ============================================================

/**
 * เริ่มเดินทาง — Driver บันทึกเลขไมล์ออก
 * payload: { requestId, start_mileage, notes }
 */
function Trip_start(session, payload) {
  if (!Auth_isDriver(session) && !Auth_isManager(session) && !Auth_isAdmin(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์');
  }
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (r.status !== REQUEST_STATUS.APPROVED) return err('invalid_status', 'คำขอยังไม่พร้อมเริ่มเดินทาง');
  if (!payload.start_mileage) return err('invalid_input', 'กรุณากรอกเลขไมล์ออก');

  // ถ้ามี log เดิมและยังไม่จบ → error
  const existing = DB_findOne(SHEETS.TRIP_LOGS, { request_id: r.id });
  if (existing && !existing.end_mileage) return err('already_started', 'บันทึกการออกเดินทางไปแล้ว');

  DB_insert(SHEETS.TRIP_LOGS, {
    id: Utils_genId(),
    request_id: r.id,
    vehicle_id: r.vehicle_id,
    driver_id: r.driver_id,
    start_mileage: Number(payload.start_mileage),
    end_mileage: '',
    distance: '',
    start_time: Utils_now(),
    end_time: '',
    notes: payload.notes || '',
    created_at: Utils_now()
  });

  DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.IN_PROGRESS, updated_at: Utils_now() });
  DB_update(SHEETS.VEHICLES, r.vehicle_id, { status: VEHICLE_STATUS.IN_USE });

  _logApproval(r.id, session, APPROVAL_ACTIONS.START, 3, 'เริ่มเดินทาง เลขไมล์: ' + payload.start_mileage);
  Utils_audit(session.userId, session.username, 'trip.start', 'request', r.id, { mileage: payload.start_mileage });
  return ok(true);
}

/**
 * จบเดินทาง — Driver บันทึกเลขไมล์กลับ
 * payload: { requestId, end_mileage, notes }
 */
function Trip_complete(session, payload) {
  if (!Auth_isDriver(session) && !Auth_isManager(session) && !Auth_isAdmin(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์');
  }
  const r = DB_findById(SHEETS.REQUESTS, payload.requestId);
  if (!r) return err('not_found', 'ไม่พบคำขอ');
  if (r.status !== REQUEST_STATUS.IN_PROGRESS) return err('invalid_status', 'คำขอยังไม่ได้อยู่ในระหว่างเดินทาง');
  if (!payload.end_mileage) return err('invalid_input', 'กรุณากรอกเลขไมล์กลับ');

  const trip = DB_findOne(SHEETS.TRIP_LOGS, { request_id: r.id });
  if (!trip) return err('not_found', 'ไม่พบบันทึกการเดินทาง');

  const endM = Number(payload.end_mileage);
  const distance = endM - Number(trip.start_mileage);
  if (distance < 0) return err('invalid_input', 'เลขไมล์กลับต้องไม่น้อยกว่าเลขไมล์ออก');

  DB_update(SHEETS.TRIP_LOGS, trip.id, {
    end_mileage: endM,
    distance: distance,
    end_time: Utils_now(),
    notes: (trip.notes || '') + (payload.notes ? ' | ' + payload.notes : '')
  });

  DB_update(SHEETS.REQUESTS, r.id, { status: REQUEST_STATUS.COMPLETED, updated_at: Utils_now() });

  // อัพเดตเลขไมล์รถ + คืนสถานะ
  DB_update(SHEETS.VEHICLES, r.vehicle_id, {
    current_mileage: endM,
    status: VEHICLE_STATUS.AVAILABLE
  });

  _logApproval(r.id, session, APPROVAL_ACTIONS.COMPLETE, 3, 'เดินทางเสร็จสิ้น ระยะทาง: ' + distance + ' กม.');
  Utils_audit(session.userId, session.username, 'trip.complete', 'request', r.id, { distance: distance });
  return ok(true);
}

/**
 * งานของ driver (คำขอที่ assign ให้ตนเองและยังไม่จบ)
 */
function Trip_myTasks(session) {
  if (!Auth_isDriver(session)) return ok([]);
  // หา driver record ที่ email ตรงกัน
  const driver = DB_findOne(SHEETS.DRIVERS, { email: session.email });
  if (!driver) return ok([]);
  const active = DB_findAll(SHEETS.REQUESTS).filter(r =>
    r.driver_id === driver.id &&
    [REQUEST_STATUS.APPROVED, REQUEST_STATUS.IN_PROGRESS].indexOf(r.status) >= 0
  );
  active.sort((a,b) => String(a.depart_date + a.depart_time).localeCompare(String(b.depart_date + b.depart_time)));
  return ok(active);
}

// ============================================================
//  FUEL LOG
// ============================================================

function Fuel_list(session, payload) {
  payload = payload || {};
  let rows = DB_findAll(SHEETS.FUEL_LOGS);
  if (payload.vehicleId) rows = rows.filter(f => f.vehicle_id === payload.vehicleId);
  rows.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  return ok(rows);
}

function Fuel_save(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session) && !Auth_isDriver(session)) {
    return err('forbidden', 'ไม่มีสิทธิ์');
  }
  const missing = Utils_required(payload, ['vehicle_id','date','liters','cost_per_liter']);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  const liters = Number(payload.liters);
  const cpl    = Number(payload.cost_per_liter);
  const total  = liters * cpl;

  if (payload.id) {
    const updated = DB_update(SHEETS.FUEL_LOGS, payload.id, {
      vehicle_id: payload.vehicle_id,
      driver_id: payload.driver_id || '',
      date: payload.date,
      liters: liters,
      cost_per_liter: cpl,
      total_cost: total,
      mileage: Number(payload.mileage) || 0,
      receipt_no: payload.receipt_no || '',
      notes: payload.notes || ''
    });
    return ok(updated);
  } else {
    const created = DB_insert(SHEETS.FUEL_LOGS, {
      id: Utils_genId(),
      vehicle_id: payload.vehicle_id,
      driver_id: payload.driver_id || '',
      date: payload.date,
      liters: liters,
      cost_per_liter: cpl,
      total_cost: total,
      mileage: Number(payload.mileage) || 0,
      receipt_no: payload.receipt_no || '',
      notes: payload.notes || '',
      created_at: Utils_now()
    });
    return ok(created);
  }
}

function Fuel_delete(session, id) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  DB_delete(SHEETS.FUEL_LOGS, id);
  return ok(true);
}

// ============================================================
//  MAINTENANCE LOG
// ============================================================

function Maint_list(session, payload) {
  payload = payload || {};
  let rows = DB_findAll(SHEETS.MAINT_LOGS);
  if (payload.vehicleId) rows = rows.filter(m => m.vehicle_id === payload.vehicleId);
  rows.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  return ok(rows);
}

function Maint_save(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  const missing = Utils_required(payload, ['vehicle_id','date','type']);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  if (payload.id) {
    const updated = DB_update(SHEETS.MAINT_LOGS, payload.id, {
      vehicle_id: payload.vehicle_id,
      date: payload.date,
      type: payload.type,
      description: payload.description || '',
      cost: Number(payload.cost) || 0,
      vendor: payload.vendor || '',
      next_due: payload.next_due || '',
      notes: payload.notes || ''
    });
    return ok(updated);
  } else {
    const created = DB_insert(SHEETS.MAINT_LOGS, {
      id: Utils_genId(),
      vehicle_id: payload.vehicle_id,
      date: payload.date,
      type: payload.type,
      description: payload.description || '',
      cost: Number(payload.cost) || 0,
      vendor: payload.vendor || '',
      next_due: payload.next_due || '',
      notes: payload.notes || '',
      created_at: Utils_now()
    });
    return ok(created);
  }
}

function Maint_delete(session, id) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  DB_delete(SHEETS.MAINT_LOGS, id);
  return ok(true);
}

// ============================================================
//  USER MANAGEMENT (Admin only)
// ============================================================

function User_list(session, payload) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบ');
  const rows = DB_findAll(SHEETS.USERS).map(Utils_stripUser);
  rows.sort((a,b) => String(a.username).localeCompare(String(b.username)));
  return ok(rows);
}

function User_get(session, id) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบ');
  const u = DB_findById(SHEETS.USERS, id);
  if (!u) return err('not_found', 'ไม่พบผู้ใช้');
  return ok(Utils_stripUser(u));
}

function User_save(session, payload) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบ');
  const missing = Utils_required(payload, ['username','fullname','email','role']);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));
  if (!Utils_isEmail(payload.email)) return err('invalid_email', 'อีเมลไม่ถูกต้อง');

  if (payload.id) {
    const existing = DB_findById(SHEETS.USERS, payload.id);
    if (!existing) return err('not_found', 'ไม่พบผู้ใช้');

    const patch = {
      username: payload.username,
      fullname: payload.fullname,
      email: payload.email,
      department: payload.department || '',
      position: payload.position || '',
      phone: payload.phone || '',
      role: payload.role,
      status: payload.status || existing.status,
      updated_at: Utils_now()
    };

    // ถ้าตั้งรหัสผ่านใหม่
    if (payload.password) {
      if (String(payload.password).length < 8) return err('weak_password', 'รหัสผ่านอย่างน้อย 8 ตัวอักษร');
      const salt = Utils_genSalt();
      patch.salt = salt;
      patch.password_hash = Utils_hashPassword(payload.password, salt);
    }

    const updated = DB_update(SHEETS.USERS, payload.id, patch);
    Utils_audit(session.userId, session.username, 'user.update', 'user', payload.id, '');
    return ok(Utils_stripUser(updated));
  } else {
    // create
    if (!payload.password) return err('invalid_input', 'กรุณากรอกรหัสผ่าน');
    if (String(payload.password).length < 8) return err('weak_password', 'รหัสผ่านอย่างน้อย 8 ตัวอักษร');
    const dup = DB_findOne(SHEETS.USERS, { username: payload.username });
    if (dup) return err('duplicate', 'username นี้ถูกใช้แล้ว');

    const salt = Utils_genSalt();
    const created = DB_insert(SHEETS.USERS, {
      id: Utils_genId(),
      username: payload.username,
      password_hash: Utils_hashPassword(payload.password, salt),
      salt: salt,
      fullname: payload.fullname,
      email: payload.email,
      department: payload.department || '',
      position: payload.position || '',
      phone: payload.phone || '',
      role: payload.role,
      status: payload.status || 'active',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'user.create', 'user', created.id, '');
    return ok(Utils_stripUser(created));
  }
}

function User_delete(session, id) {
  if (!Auth_isAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบ');
  if (id === session.userId) return err('forbidden', 'ไม่สามารถลบบัญชีตนเอง');
  DB_delete(SHEETS.USERS, id);
  Utils_audit(session.userId, session.username, 'user.delete', 'user', id, '');
  return ok(true);
}

// ============================================================
//  LOOKUP (ข้อมูลชุดสำหรับ dropdown)
// ============================================================

function Lookup_all(session) {
  const vehicles = DB_findAll(SHEETS.VEHICLES).filter(v => v.status !== VEHICLE_STATUS.RETIRED);
  const drivers  = DB_findAll(SHEETS.DRIVERS).filter(d => d.status === 'active');
  return ok({
    vehicles: vehicles,
    drivers: drivers,
    vehicleTypes: VEHICLE_TYPES,
    statusLabels: STATUS_LABELS,
    vehicleStatusLabels: VEHICLE_STATUS_LABELS,
    roleLabels: ROLE_LABELS
  });
}
