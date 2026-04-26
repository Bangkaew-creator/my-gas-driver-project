/**
 * ============================================================================
 *  Adapters.gs — DTO (Data Transfer Object) layer
 *  ทำหน้าที่ map ฟิลด์ระหว่าง schema ฐานข้อมูล (สั้น/ไทย) ↔ รูปแบบที่
 *  client ฝั่ง UI ใช้งาน (อ่านสะดวก + enrich ด้วย label/color/datetime)
 *
 *  Pattern:
 *    - Adapter_xxxIn(payload)   :  client → backend (สำหรับ create/update)
 *    - Adapter_xxxOut(row)      :  backend → client (สำหรับ list/get)
 *
 *  ใช้งานใน Code.gs ที่จุด api() เท่านั้น — service ไม่ต้องรับรู้ adapter
 * ============================================================================
 */

/* ---------------- Helper ---------------- */

function Adapter_wrapList(rows, fn) {
  return { items: (rows || []).map(fn || (x => x)) };
}

/* ---------------- Request ---------------- */

function Adapter_statusInfo_(status) {
  const s = (typeof STATUS_LABELS !== 'undefined' && STATUS_LABELS[status]) || {};
  return {
    status_label: s.text || status || '-',
    status_color: s.color || '#64748b',
    status_bg: s.bg || '#e2e8f0'
  };
}

function Adapter_requestOut(r) {
  if (!r) return r;
  const s = Adapter_statusInfo_(r.status);
  const startDt = Utils_combineDateTime(r.depart_date, r.depart_time);
  const endDt   = Utils_combineDateTime(r.return_date, r.return_time);
  const safeIso = (d) => {
    if (!d) return null;
    try { return d.toISOString(); } catch (e) { return null; }
  };
  return Object.assign({}, r, s, {
    start_datetime: safeIso(startDt),
    end_datetime:   safeIso(endDt),
    passengers: r.passengers_count,
    origin: r.department || '',
    contact: r.phone || '',
    description: r.notes || ''
  });
}

function Adapter_requestIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.start_date   && !p.depart_date) p.depart_date = p.start_date;
  if (p.start_time   && !p.depart_time) p.depart_time = p.start_time;
  if (p.end_date     && !p.return_date) p.return_date = p.end_date;
  if (p.end_time     && !p.return_time) p.return_time = p.end_time;
  if (p.passengers != null && p.passengers_count == null) p.passengers_count = Number(p.passengers);
  if (p.description != null && p.notes == null) p.notes = p.description;
  if (p.contact != null && p.phone == null) p.phone = p.contact;
  if (p.origin && p.destination && String(p.destination).indexOf('→') < 0) {
    p.destination = p.origin + ' → ' + p.destination;
  }
  return p;
}

/* ---------------- Vehicle ---------------- */

function Adapter_vehicleOut(v) {
  if (!v) return v;
  const label = (typeof VEHICLE_STATUS_LABELS !== 'undefined' && VEHICLE_STATUS_LABELS[v.status]) || v.status;
  const colorMap = { available: '#10b981', in_use: '#8b5cf6', maintenance: '#f59e0b', retired: '#64748b' };
  const typeLabel = (typeof VEHICLE_TYPES !== 'undefined' && VEHICLE_TYPES[v.type]) || v.type;
  return Object.assign({}, v, {
    plate: v.plate_number,
    type: typeLabel,
    type_key: v.type,
    status_label: label,
    status_color: colorMap[v.status] || '#64748b',
    remark: v.notes || ''
  });
}

function Adapter_vehicleIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.plate != null && p.plate_number == null) p.plate_number = p.plate;
  if (p.remark != null && p.notes == null) p.notes = p.remark;
  return p;
}

/* ---------------- Driver ---------------- */

function Adapter_driverOut(d) {
  if (!d) return d;
  let username = '';
  if (d.email) {
    try {
      const u = DB_findOne(SHEETS.USERS, { email: d.email });
      if (u) username = u.username;
    } catch (e) { /* ignore */ }
  }
  return Object.assign({}, d, {
    full_name: d.fullname,
    license_no: d.license_number,
    user_username: username,
    user_id: '', // ผูกผ่าน email (ดู Adapter_driverIn)
    remark: d.notes || ''
  });
}

function Adapter_driverIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.full_name != null && p.fullname == null) p.fullname = p.full_name;
  if (p.license_no != null && p.license_number == null) p.license_number = p.license_no;
  if (p.remark != null && p.notes == null) p.notes = p.remark;
  if (p.user_id && !p.email) {
    const u = DB_findById(SHEETS.USERS, p.user_id);
    if (u && u.email) p.email = u.email;
  }
  return p;
}

/* ---------------- User ---------------- */

function Adapter_userOut(u) {
  if (!u) return u;
  const label = (typeof ROLE_LABELS !== 'undefined' && ROLE_LABELS[u.role]) || u.role;
  return Object.assign({}, u, {
    full_name: u.fullname,
    role_label: label
  });
}

function Adapter_userIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.full_name != null && p.fullname == null) p.fullname = p.full_name;
  return p;
}

/* ---------------- Approval history ---------------- */

function Adapter_historyOut(h) {
  if (!h) return h;
  const labels = {
    submit: 'ยื่นคำขอ',
    approve: 'อนุมัติ',
    reject: 'ไม่อนุมัติ',
    assign: 'จัดรถ/คนขับ',
    cancel: 'ยกเลิก',
    trip_start: 'เริ่มเดินทาง',
    trip_complete: 'สิ้นสุดการเดินทาง'
  };
  return Object.assign({}, h, {
    actor_name: h.approver_name || '',
    action_label: labels[h.action] || h.action,
    remark: h.comment || ''
  });
}

/* ---------------- Trip ---------------- */

function Adapter_tripOut(t) {
  if (!t) return t;
  return Object.assign({}, t, { remark: t.notes || '' });
}

/* ---------------- Fuel ---------------- */

function Adapter_fuelOut(f) {
  if (!f) return f;
  let plate = '';
  if (f.vehicle_id) {
    const v = DB_findById(SHEETS.VEHICLES, f.vehicle_id);
    if (v) plate = v.plate_number;
  }
  return Object.assign({}, f, {
    fill_date: f.date,
    price_per_liter: f.cost_per_liter,
    vehicle_plate: plate,
    station: f.notes && /ปั๊ม:/i.test(f.notes) ? (String(f.notes).split('ปั๊ม:')[1] || '').trim() : '',
    remark: f.notes || ''
  });
}

function Adapter_fuelIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.fill_date != null && p.date == null) p.date = p.fill_date;
  if (p.price_per_liter != null && p.cost_per_liter == null) p.cost_per_liter = Number(p.price_per_liter);
  // compute total_cost
  if (p.cost_per_liter != null && p.liters != null && p.total_cost == null) {
    p.total_cost = Number(p.cost_per_liter) * Number(p.liters);
  }
  // merge station into notes
  if (p.station) {
    p.notes = ((p.notes || '') + ' ปั๊ม: ' + p.station).trim();
  }
  if (p.remark != null && p.notes == null) p.notes = p.remark;
  return p;
}

/* ---------------- Maintenance ---------------- */

function Adapter_maintOut(m) {
  if (!m) return m;
  let plate = '';
  if (m.vehicle_id) {
    const v = DB_findById(SHEETS.VEHICLES, m.vehicle_id);
    if (v) plate = v.plate_number;
  }
  return Object.assign({}, m, {
    maint_date: m.date,
    vehicle_plate: plate
  });
}

function Adapter_maintIn(payload) {
  const p = Object.assign({}, payload || {});
  if (p.maint_date != null && p.date == null) p.date = p.maint_date;
  return p;
}

/* ---------------- Lookup ---------------- */

function Adapter_lookupAll(session) {
  const toArr = (obj, extract) => Object.keys(obj).map(k => ({ key: k, label: extract ? extract(obj[k]) : obj[k] }));

  const vehiclesAllRows = DB_findAll(SHEETS.VEHICLES).filter(v => v.status !== VEHICLE_STATUS.RETIRED);
  const driversRows     = DB_findAll(SHEETS.DRIVERS).filter(d => d.status === 'active');
  const driverCandidates = DB_findAll(SHEETS.USERS).filter(u => u.role === ROLES.DRIVER && u.status === 'active');

  return {
    vehicleTypes:     toArr(VEHICLE_TYPES),
    vehicleStatuses:  toArr(VEHICLE_STATUS_LABELS),
    roles:            toArr(ROLE_LABELS),
    statusList:       toArr(STATUS_LABELS, s => s.text),
    vehiclesAll:      vehiclesAllRows.map(Adapter_vehicleOut),
    drivers:          driversRows.map(Adapter_driverOut),
    driverCandidates: driverCandidates.map(Adapter_userOut)
  };
}

/* ---------------- Dashboard ---------------- */

function Adapter_dashboardOut(d) {
  if (!d) return d;
  const bs = d.byStatus || {};
  const vs = d.vehicleStats || {};
  const ds = d.driverStats || {};
  const stats = {
    totalRequests:     d.totalRequests || 0,
    pending:           (bs[REQUEST_STATUS.PENDING] || 0) + (bs[REQUEST_STATUS.APPROVED_L1] || 0),
    approved:          bs[REQUEST_STATUS.APPROVED]     || 0,
    inProgress:        bs[REQUEST_STATUS.IN_PROGRESS]  || 0,
    completed:         bs[REQUEST_STATUS.COMPLETED]    || 0,
    rejected:          bs[REQUEST_STATUS.REJECTED]     || 0,
    cancelled:         bs[REQUEST_STATUS.CANCELLED]    || 0,
    vehicles:          vs.total        || 0,
    vehiclesAvailable: vs.available    || 0,
    vehiclesInUse:     vs.in_use       || 0,
    vehiclesMaint:     vs.maintenance  || 0,
    drivers:           ds.total        || 0,
    driversActive:     ds.active       || 0,
    totalDistance:     d.totalDistance || 0,
    thisMonthCount:    d.thisMonthCount|| 0,
    myPending:         d.myPending     || 0
  };
  const recent = (d.recent || []).map(Adapter_requestOut);
  return { stats: stats, recent: recent };
}

/* ---------------- Calendar events ---------------- */

function Adapter_calendarOut(d) {
  if (!d) return d;
  const src = d.events || d.requests || [];
  return {
    year: d.year,
    month: d.month,
    events: src.map(Adapter_requestOut)
  };
}

/* ---------------- Request detail enrichment ---------------- */

/**
 * Enrich ผลลัพธ์จาก Request_get ด้วย vehicle + driver object
 */
function Adapter_requestDetailOut(data) {
  if (!data) return data;
  const req = Adapter_requestOut(data.request);
  const history = (data.history || []).map(Adapter_historyOut);
  const trip = Adapter_tripOut(data.trip);

  let vehicle = null, driver = null;
  if (req && req.vehicle_id) {
    const v = DB_findById(SHEETS.VEHICLES, req.vehicle_id);
    if (v) vehicle = Adapter_vehicleOut(v);
  }
  if (req && req.driver_id) {
    const dr = DB_findById(SHEETS.DRIVERS, req.driver_id);
    if (dr) driver = Adapter_driverOut(dr);
  }

  return { request: req, history: history, trip: trip, vehicle: vehicle, driver: driver };
}

/* ---------------- Approval pending enrichment ---------------- */

function Adapter_approvalOut(data) {
  // ถ้า service ส่ง list ตรง ๆ
  if (Array.isArray(data)) return { items: data.map(Adapter_requestOut), roleHint: '' };
  // ถ้าส่ง { items, roleHint }
  if (data && data.items) return Object.assign({}, data, { items: data.items.map(Adapter_requestOut) });
  return data;
}

/* ---------------- Vehicle availability ---------------- */

function Adapter_availabilityOut(data) {
  if (!data) return data;
  const out = Object.assign({}, data);
  if (out.vehicles) out.vehicles = out.vehicles.map(Adapter_vehicleOut);
  if (out.drivers)  out.drivers  = out.drivers.map(Adapter_driverOut);
  // ถ้า service ส่งกลับมาเป็น array ตรง ๆ
  if (Array.isArray(data)) return { vehicles: data.map(Adapter_vehicleOut), drivers: [] };
  return out;
}

/* ---------------- Generic "me" enrichment ---------------- */

function Adapter_meOut(data) {
  if (!data) return data;
  if (data.user) return Object.assign({}, data.user, Adapter_userOut(data.user), { roleLabel: data.roleLabel });
  return data;
}

/* ---------------- Login result ---------------- */

function Adapter_loginOut(data) {
  if (!data) return data;
  return Object.assign({}, data, {
    user: Adapter_userOut(data.user)
  });
}

/* ---------------- Report ----------------
 * ReportService ส่งข้อมูลแบบ nested (rows: [{vehicle:{...}, count, distance}])
 * Views.reportTable คาดหวัง flat {title, columns, rows[], totals?}
 * ตัว adapter ด้านล่างจะแปลงรูปแบบให้ตรงตาม report type
 */

function Adapter_reportByVehicleOut(data) {
  if (!data) return data;
  const rows = (data.rows || []).map(r => ({
    plate:    (r.vehicle && r.vehicle.plate_number) || '(ลบแล้ว)',
    brand:    (r.vehicle && r.vehicle.brand)  || '',
    model:    (r.vehicle && r.vehicle.model)  || '',
    count:    r.count || 0,
    distance: r.distance || 0
  }));
  const totals = {
    plate:   'รวม',
    count:   rows.reduce((s,r)=>s+(r.count||0), 0),
    distance:rows.reduce((s,r)=>s+(r.distance||0), 0)
  };
  return {
    title: 'รายงานแยกตามรถ',
    from: data.from, to: data.to,
    columns: [
      { key: 'plate',    label: 'ทะเบียน' },
      { key: 'brand',    label: 'ยี่ห้อ' },
      { key: 'model',    label: 'รุ่น' },
      { key: 'count',    label: 'จำนวนครั้ง', format: 'num' },
      { key: 'distance', label: 'ระยะทางรวม (กม.)', format: 'num' }
    ],
    rows: rows,
    totals: totals
  };
}

function Adapter_reportByDepartmentOut(data) {
  if (!data) return data;
  const rows = (data.rows || []).map(r => ({
    department: r.department || '(ไม่ระบุ)',
    count:      r.count     || 0,
    completed:  r.completed || 0,
    rejected:   r.rejected  || 0,
    distance:   r.distance  || 0
  }));
  const totals = {
    department: 'รวม',
    count:     rows.reduce((s,r)=>s+r.count, 0),
    completed: rows.reduce((s,r)=>s+r.completed, 0),
    rejected:  rows.reduce((s,r)=>s+r.rejected, 0),
    distance:  rows.reduce((s,r)=>s+r.distance, 0)
  };
  return {
    title: 'รายงานแยกตามหน่วยงาน',
    from: data.from, to: data.to,
    columns: [
      { key: 'department', label: 'หน่วยงาน' },
      { key: 'count',      label: 'คำขอทั้งหมด', format: 'num' },
      { key: 'completed',  label: 'สำเร็จ',       format: 'num' },
      { key: 'rejected',   label: 'ไม่อนุมัติ',   format: 'num' },
      { key: 'distance',   label: 'ระยะทาง (กม.)', format: 'num' }
    ],
    rows: rows,
    totals: totals
  };
}

function Adapter_reportByDriverOut(data) {
  if (!data) return data;
  const rows = (data.rows || []).map(r => ({
    fullname: (r.driver && r.driver.fullname) || '(ลบแล้ว)',
    phone:    (r.driver && r.driver.phone)    || '',
    count:    r.count    || 0,
    distance: r.distance || 0
  }));
  const totals = {
    fullname: 'รวม',
    count:    rows.reduce((s,r)=>s+r.count, 0),
    distance: rows.reduce((s,r)=>s+r.distance, 0)
  };
  return {
    title: 'รายงานแยกตามคนขับ',
    from: data.from, to: data.to,
    columns: [
      { key: 'fullname', label: 'ชื่อคนขับ' },
      { key: 'phone',    label: 'โทรศัพท์' },
      { key: 'count',    label: 'จำนวนครั้ง',      format: 'num' },
      { key: 'distance', label: 'ระยะทางรวม (กม.)', format: 'num' }
    ],
    rows: rows,
    totals: totals
  };
}

function Adapter_reportUsageSummaryOut(data) {
  if (!data) return data;
  const rows = (data.months || []).map(m => ({
    monthName: m.monthName,
    requests:  m.requests  || 0,
    completed: m.completed || 0,
    rejected:  m.rejected  || 0,
    distance:  m.distance  || 0
  }));
  const totals = {
    monthName: 'รวม',
    requests:  rows.reduce((s,r)=>s+r.requests, 0),
    completed: rows.reduce((s,r)=>s+r.completed, 0),
    rejected:  rows.reduce((s,r)=>s+r.rejected, 0),
    distance:  rows.reduce((s,r)=>s+r.distance, 0)
  };
  return {
    title: 'สรุปการใช้รถ ปี ' + (data.year || ''),
    year: data.year,
    columns: [
      { key: 'monthName', label: 'เดือน' },
      { key: 'requests',  label: 'คำขอ',     format: 'num' },
      { key: 'completed', label: 'สำเร็จ',   format: 'num' },
      { key: 'rejected',  label: 'ไม่อนุมัติ', format: 'num' },
      { key: 'distance',  label: 'ระยะทาง (กม.)', format: 'num' }
    ],
    rows: rows,
    totals: totals
  };
}

/* legacy no-op (เก็บไว้เผื่อมีที่เรียกอยู่) */
function Adapter_reportOut(data) {
  return data;
}
