/**
 * ============================================================================
 *  ReportService.gs — Dashboard + Reports
 * ============================================================================
 */

/**
 * ภาพรวมสำหรับ dashboard
 */
function Report_dashboard(session) {
  const requests = DB_findAll(SHEETS.REQUESTS);
  const vehicles = DB_findAll(SHEETS.VEHICLES);
  const drivers  = DB_findAll(SHEETS.DRIVERS);
  const trips    = DB_findAll(SHEETS.TRIP_LOGS);

  // นับตามสถานะ
  const byStatus = {};
  Object.keys(REQUEST_STATUS).forEach(k => { byStatus[REQUEST_STATUS[k]] = 0; });
  requests.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  // เดือนนี้
  const now = new Date();
  const thisMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
  const thisMonthCount = requests.filter(r =>
    r.created_at && String(r.created_at).indexOf(thisMonth) === 0
  ).length;

  // สถิติรถ
  const vehicleStats = {
    total: vehicles.length,
    available: vehicles.filter(v => v.status === VEHICLE_STATUS.AVAILABLE).length,
    in_use:    vehicles.filter(v => v.status === VEHICLE_STATUS.IN_USE).length,
    maintenance: vehicles.filter(v => v.status === VEHICLE_STATUS.MAINTENANCE).length
  };

  const driverStats = {
    total: drivers.length,
    active: drivers.filter(d => d.status === 'active').length
  };

  // ระยะทางรวม
  const totalDistance = trips.reduce((s, t) => s + (Number(t.distance) || 0), 0);

  // คำขอล่าสุด 5 รายการ (เฉพาะที่เกี่ยวข้อง)
  let recent = requests.slice();
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) {
    recent = recent.filter(r => r.requester_id === session.userId);
  }
  recent.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  recent = recent.slice(0, 5);

  // pending ของฉันต้องอนุมัติ
  let myPending = 0;
  if (Auth_isApprover(session) || Auth_isAdmin(session)) {
    myPending += requests.filter(r => r.status === REQUEST_STATUS.PENDING).length;
  }
  if (Auth_isManager(session) || Auth_isAdmin(session)) {
    myPending += requests.filter(r => r.status === REQUEST_STATUS.APPROVED_L1).length;
  }

  return ok({
    byStatus: byStatus,
    thisMonthCount: thisMonthCount,
    vehicleStats: vehicleStats,
    driverStats: driverStats,
    totalDistance: totalDistance,
    recent: recent,
    myPending: myPending,
    totalRequests: requests.length
  });
}

/**
 * ข้อมูลปฏิทิน
 * payload: { year, month }  (month: 1-12)
 */
function Report_calendar(session, payload) {
  const year  = Number(payload.year)  || new Date().getFullYear();
  const month = Number(payload.month) || (new Date().getMonth() + 1);

  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 0, 23, 59, 59);

  const requests = DB_findAll(SHEETS.REQUESTS).filter(r => {
    if ([REQUEST_STATUS.REJECTED, REQUEST_STATUS.CANCELLED].indexOf(r.status) >= 0) return false;
    const d = r.depart_date ? new Date(r.depart_date) : null;
    return d && d >= start && d <= end;
  });

  return ok({ year: year, month: month, requests: requests });
}

/**
 * รายงานแยกตามรถ
 * payload: { from, to, vehicleId? }
 */
function Report_byVehicle(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  payload = payload || {};
  const from = payload.from ? new Date(payload.from) : new Date(new Date().getFullYear(), 0, 1);
  const to   = payload.to   ? new Date(payload.to)   : new Date();

  let trips = DB_findAll(SHEETS.TRIP_LOGS).filter(t => {
    if (!t.start_time) return false;
    const d = new Date(t.start_time);
    return d >= from && d <= to;
  });
  if (payload.vehicleId) trips = trips.filter(t => t.vehicle_id === payload.vehicleId);

  const vehicles = {};
  DB_findAll(SHEETS.VEHICLES).forEach(v => vehicles[v.id] = v);

  // group by vehicle
  const group = {};
  trips.forEach(t => {
    const vid = t.vehicle_id;
    if (!group[vid]) {
      group[vid] = {
        vehicle: vehicles[vid] || { plate_number: '(ลบแล้ว)' },
        count: 0,
        distance: 0
      };
    }
    group[vid].count++;
    group[vid].distance += Number(t.distance) || 0;
  });

  const rows = Object.values(group);
  rows.sort((a,b) => b.distance - a.distance);
  return ok({ from: from.toISOString(), to: to.toISOString(), rows: rows });
}

/**
 * รายงานแยกตามแผนก
 */
function Report_byDepartment(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  payload = payload || {};
  const from = payload.from ? new Date(payload.from) : new Date(new Date().getFullYear(), 0, 1);
  const to   = payload.to   ? new Date(payload.to)   : new Date();

  const requests = DB_findAll(SHEETS.REQUESTS).filter(r => {
    const d = r.created_at ? new Date(r.created_at) : null;
    return d && d >= from && d <= to;
  });

  const trips = DB_findAll(SHEETS.TRIP_LOGS);
  const tripByReq = {};
  trips.forEach(t => tripByReq[t.request_id] = t);

  const group = {};
  requests.forEach(r => {
    const dept = r.department || '(ไม่ระบุ)';
    if (!group[dept]) group[dept] = { department: dept, count: 0, distance: 0, completed: 0, rejected: 0 };
    group[dept].count++;
    if (r.status === REQUEST_STATUS.COMPLETED) group[dept].completed++;
    if (r.status === REQUEST_STATUS.REJECTED)  group[dept].rejected++;
    const t = tripByReq[r.id];
    if (t && t.distance) group[dept].distance += Number(t.distance) || 0;
  });

  const rows = Object.values(group);
  rows.sort((a,b) => b.count - a.count);
  return ok({ from: from.toISOString(), to: to.toISOString(), rows: rows });
}

/**
 * รายงานแยกตามคนขับ
 */
function Report_byDriver(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  payload = payload || {};
  const from = payload.from ? new Date(payload.from) : new Date(new Date().getFullYear(), 0, 1);
  const to   = payload.to   ? new Date(payload.to)   : new Date();

  const trips = DB_findAll(SHEETS.TRIP_LOGS).filter(t => {
    if (!t.start_time) return false;
    const d = new Date(t.start_time);
    return d >= from && d <= to;
  });

  const drivers = {};
  DB_findAll(SHEETS.DRIVERS).forEach(d => drivers[d.id] = d);

  const group = {};
  trips.forEach(t => {
    const did = t.driver_id;
    if (!group[did]) {
      group[did] = {
        driver: drivers[did] || { fullname: '(ลบแล้ว)' },
        count: 0,
        distance: 0
      };
    }
    group[did].count++;
    group[did].distance += Number(t.distance) || 0;
  });

  const rows = Object.values(group);
  rows.sort((a,b) => b.distance - a.distance);
  return ok({ from: from.toISOString(), to: to.toISOString(), rows: rows });
}

/**
 * สรุปการใช้งาน (ตาราง monthly)
 */
function Report_usageSummary(session, payload) {
  if (!Auth_isAdmin(session) && !Auth_isManager(session)) return err('forbidden', 'ไม่มีสิทธิ์');
  payload = payload || {};
  const year = Number(payload.year) || new Date().getFullYear();

  const requests = DB_findAll(SHEETS.REQUESTS);
  const trips = DB_findAll(SHEETS.TRIP_LOGS);

  const months = Array.from({length:12}, (_,i) => ({
    month: i + 1,
    monthName: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][i],
    requests: 0,
    completed: 0,
    rejected: 0,
    distance: 0
  }));

  requests.forEach(r => {
    if (!r.created_at) return;
    const d = new Date(r.created_at);
    if (d.getFullYear() !== year) return;
    const m = months[d.getMonth()];
    m.requests++;
    if (r.status === REQUEST_STATUS.COMPLETED) m.completed++;
    if (r.status === REQUEST_STATUS.REJECTED)  m.rejected++;
  });

  trips.forEach(t => {
    if (!t.start_time) return;
    const d = new Date(t.start_time);
    if (d.getFullYear() !== year) return;
    months[d.getMonth()].distance += Number(t.distance) || 0;
  });

  return ok({ year: year, months: months });
}
