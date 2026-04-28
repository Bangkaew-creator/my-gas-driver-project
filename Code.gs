/**
 * ============================================================================
 *  Code.gs — Entry point + API Gateway
 *  - doGet:  Serve SPA
 *  - api():  single gateway สำหรับ google.script.run ทุก request
 *  - ทำ DTO adaptation ที่ boundary นี้ (service layer ไม่ต้องรู้เรื่อง frontend)
 * ============================================================================
 */

/* =========================================================================
 *  Web App entry
 * ======================================================================= */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.orgName    = ORG_NAME;
  template.systemName = SYSTEM_NAME;
  return template.evaluate()
    .setTitle(SYSTEM_NAME + ' | ' + ORG_NAME)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * รวมไฟล์ HTML ใช้ใน <?!= include('xxx') ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* =========================================================================
 *  API Gateway
 *  สัญญา:
 *    api(action, token, payload)
 *  คืน: { ok: true, data } หรือ { ok: false, error: { code, message } }
 * ======================================================================= */
function api(action, token, payload) {
  try {
    payload = payload || {};

    /* ---- public actions (ไม่ต้อง login) ---- */
    if (action === 'ping')  return ok({ time: new Date().toISOString(), system: SYSTEM_NAME });
    if (action === 'login') {
      const r = Auth_login(payload.username, payload.password);
      return r.ok ? ok(Adapter_loginOut(r.data)) : r;
    }

    /* ---- ทุก action หลังจากนี้ต้องมี session ---- */
    const session = Auth_getSession(token);
    if (!session) return err('session_expired', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

    /* ---- routing + adapter wrapping ---- */
    switch (action) {

      /* ============ Auth / Profile ============ */
      case 'logout':
        return Auth_logout(token);

      case 'me': {
        const me = Auth_getMe(session);
        return ok(Adapter_meOut(me));
      }

      case 'user.changePass':
        return Auth_changePassword(session, payload.oldPass, payload.newPass);

      /* ============ Request (คำขอใช้รถ) ============ */
      case 'request.list': {
        const r = Request_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_requestOut) }) : r;
      }

      case 'request.get': {
        const r = Request_get(session, payload.id);
        return r.ok ? ok(Adapter_requestDetailOut(r.data)) : r;
      }

      case 'request.create': {
        const r = Request_create(session, Adapter_requestIn(payload));
        return r.ok ? ok(Adapter_requestOut(r.data)) : r;
      }

      case 'request.update': {
        const r = Request_update(session, Adapter_requestIn(payload));
        return r.ok ? ok(Adapter_requestOut(r.data)) : r;
      }

      case 'request.cancel':
        return Request_cancel(session, payload.id, payload.reason);

      case 'request.myInbox': {
        const r = Request_myInbox(session);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_requestOut) }) : r;
      }

      case 'request.printBatch': {
        const r = Request_printBatch(session, payload);
        if (!r.ok) return r;
        const items = (r.data.items || []).map(Adapter_requestDetailOut);
        return ok({ items: items });
      }

      /* ============ Approval ============ */
      case 'approval.pending': {
        const r = Approval_pendingList(session);
        if (!r.ok) return r;
        return ok({
          items: (r.data || []).map(Adapter_requestOut),
          roleHint: _approvalRoleHint(session)
        });
      }

      case 'approval.approve':  return Approval_approve(session, {
        requestId: payload.request_id || payload.requestId,
        comment:   payload.remark || payload.comment || ''
      });
      case 'approval.reject':   return Approval_reject(session, {
        requestId: payload.request_id || payload.requestId,
        comment:   payload.reason || payload.remark || payload.comment || ''
      });
      case 'approval.assign':   return Approval_assign();

      case 'approval.history': {
        const r = Approval_history(session, payload.requestId);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_historyOut) }) : r;
      }

      /* ============ Vehicle ============ */
      case 'vehicle.list': {
        const r = Vehicle_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_vehicleOut) }) : r;
      }

      case 'vehicle.get': {
        const r = Vehicle_get(session, payload.id);
        return r.ok ? ok(Adapter_vehicleOut(r.data)) : r;
      }

      case 'vehicle.save': {
        const r = Vehicle_save(session, Adapter_vehicleIn(payload));
        return r.ok ? ok(Adapter_vehicleOut(r.data)) : r;
      }

      case 'vehicle.delete':
        return Vehicle_delete(session, payload.id);

      case 'vehicle.availableOn': {
        const svcPayload = _availabilityPayloadIn(payload);
        const r = Vehicle_availableOn(session, svcPayload);
        if (!r.ok) return r;
        let vehicles = (r.data || []).map(Adapter_vehicleOut);
        // filter ตาม min_seats หาก frontend ส่งมา
        if (payload.min_seats) {
          const ms = Number(payload.min_seats) || 0;
          if (ms > 0) vehicles = vehicles.filter(v => (Number(v.seats) || 0) >= ms);
        }
        const drivers = _availableDrivers(session, payload.start_datetime, payload.end_datetime).map(Adapter_driverOut);
        return ok({ vehicles: vehicles, drivers: drivers });
      }

      case 'vehicle.availabilityCheck': {
        const svcPayload = _availabilityPayloadIn(payload);
        svcPayload.min_seats = payload.min_seats || 0;
        return Vehicle_availabilityCheck(session, svcPayload);
      }

      case 'vehicle.schedule':
        return Vehicle_schedule(session, payload);

      case 'driver.schedule':
        return Driver_schedule(session, payload);

      /* ============ Driver ============ */
      case 'driver.list': {
        const r = Driver_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_driverOut) }) : r;
      }

      case 'driver.get': {
        const r = Driver_get(session, payload.id);
        return r.ok ? ok(Adapter_driverOut(r.data)) : r;
      }

      case 'driver.save': {
        const r = Driver_save(session, Adapter_driverIn(payload));
        return r.ok ? ok(Adapter_driverOut(r.data)) : r;
      }

      case 'driver.delete':
        return Driver_delete(session, payload.id);

      /* ============ Trip Log ============ */
      case 'trip.start':    return Trip_start(session, payload);
      case 'trip.complete': return Trip_complete(session, payload);

      case 'trip.myTasks': {
        const r = Trip_myTasks(session);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_requestOut) }) : r;
      }

      /* ============ Fuel Log ============ */
      case 'fuel.list': {
        const r = Fuel_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_fuelOut) }) : r;
      }

      case 'fuel.save': {
        const r = Fuel_save(session, Adapter_fuelIn(payload));
        return r.ok ? ok(Adapter_fuelOut(r.data)) : r;
      }

      case 'fuel.delete':
        return Fuel_delete(session, payload.id);

      /* ============ Maintenance Log ============ */
      case 'maint.list': {
        const r = Maint_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_maintOut) }) : r;
      }

      case 'maint.save': {
        const r = Maint_save(session, Adapter_maintIn(payload));
        return r.ok ? ok(Adapter_maintOut(r.data)) : r;
      }

      case 'maint.delete':
        return Maint_delete(session, payload.id);

      /* ============ User Management ============ */
      case 'user.list': {
        const r = User_list(session, payload);
        return r.ok ? ok({ items: (r.data || []).map(Adapter_userOut) }) : r;
      }

      case 'user.get': {
        const r = User_get(session, payload.id);
        return r.ok ? ok(Adapter_userOut(r.data)) : r;
      }

      case 'user.save': {
        const r = User_save(session, Adapter_userIn(payload));
        return r.ok ? ok(Adapter_userOut(r.data)) : r;
      }

      case 'user.saveSignature': {
        const r = User_saveSignature(session, payload);
        return r.ok ? ok(Adapter_userOut(r.data)) : r;
      }

      case 'user.delete':
        return User_delete(session, payload.id);

      /* ============ Divisions ============ */
      case 'division.list': {
        const r = Division_list(session, payload);
        return r.ok ? ok({ items: r.data }) : r;
      }

      case 'division.get': {
        const r = Division_get(session, payload.id);
        return r.ok ? ok(r.data) : r;
      }

      case 'division.save': {
        const r = Division_save(session, payload);
        return r.ok ? ok(r.data) : r;
      }

      case 'division.delete':
        return Division_delete(session, payload.id);

      /* ============ Reports ============ */
      case 'report.dashboard': {
        const r = Report_dashboard(session);
        return r.ok ? ok(Adapter_dashboardOut(r.data)) : r;
      }

      case 'report.calendar': {
        const r = Report_calendar(session, payload);
        return r.ok ? ok(Adapter_calendarOut(r.data)) : r;
      }

      case 'report.byVehicle': {
        const r = Report_byVehicle(session, payload);
        return r.ok ? ok(Adapter_reportByVehicleOut(r.data)) : r;
      }

      case 'report.byDepartment': {
        const r = Report_byDepartment(session, payload);
        return r.ok ? ok(Adapter_reportByDepartmentOut(r.data)) : r;
      }

      case 'report.byDriver': {
        const r = Report_byDriver(session, payload);
        return r.ok ? ok(Adapter_reportByDriverOut(r.data)) : r;
      }

      case 'report.usageSummary': {
        const r = Report_usageSummary(session, payload);
        return r.ok ? ok(Adapter_reportUsageSummaryOut(r.data)) : r;
      }

      /* ============ Lookup ============ */
      case 'lookup.all':
        return ok(Adapter_lookupAll(session));

      /* ============ Unknown ============ */
      default:
        return err('unknown_action', 'ไม่รู้จัก action: ' + action);
    }

  } catch (e) {
    Utils_logError(action, e);
    return err('internal_error', e.message || String(e));
  }
}

/* =========================================================================
 *  Helpers — response wrappers
 *  NOTE: `ok()` does a JSON roundtrip so non-serializable values (e.g. the
 *        `__row` helper, cyclic refs, functions) can never reach the bridge.
 *        google.script.run can return `undefined` silently if serialization
 *        fails for any field → client sees "ไม่มีข้อมูลตอบกลับ".
 * ======================================================================= */
function ok(data) {
  if (data === undefined) return { ok: true, data: null };
  try {
    // deep-clone via JSON → primitives only (Dates → ISO strings)
    const clean = JSON.parse(JSON.stringify(data, _serializeReplacer_));
    return { ok: true, data: clean };
  } catch (e) {
    console.error('ok() serialization failed:', e);
    return { ok: false, error: { code: 'serialize_fail', message: 'ตอบกลับไม่สามารถแปลงเป็น JSON ได้: ' + (e.message || String(e)) } };
  }
}
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }

/**
 * Drop internal/non-transport fields and convert special values.
 */
function _serializeReplacer_(key, value) {
  if (key === '__row') return undefined;                  // drop DB internal
  if (value instanceof Date) return value.toISOString();  // normalize Date
  return value;
}

/* =========================================================================
 *  Internal helpers
 * ======================================================================= */

/**
 * คืนคำอธิบายภาษาไทยว่าผู้ใช้ปัจจุบันอนุมัติได้ในระดับใด
 *  ใช้แสดงบน "คิวอนุมัติของฉัน"
 */
function _approvalRoleHint(session) {
  return Approval_roleHint(session);
}

/**
 * หาคนขับที่ว่างในช่วงเวลา (ISO string)
 *  - คัดออก: คนขับที่มีคำขอสถานะ APPROVED หรือ IN_PROGRESS ซ้อนช่วงเวลา
 */
function _availableDrivers(session, startISO, endISO) {
  var allDrivers = DB_findAll(SHEETS.DRIVERS).filter(function(d) { return d.status === 'active'; });
  // Division scoping: กรองเฉพาะคนขับของกองตัวเอง (และคนขับที่ไม่ผูกกอง)
  if (!Auth_canSeeAllDivisions(session) && session && session.division_id) {
    allDrivers = allDrivers.filter(function(d) { return !d.division_id || d.division_id === session.division_id; });
  }
  if (!startISO || !endISO) return allDrivers;
  const start = new Date(startISO);
  const end   = new Date(endISO);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return allDrivers;

  const activeReqs = DB_findAll(SHEETS.REQUESTS).filter(r =>
    r.status === REQUEST_STATUS.APPROVED ||
    r.status === REQUEST_STATUS.IN_PROGRESS
  );

  const busyDriverIds = {};
  activeReqs.forEach(r => {
    if (!r.driver_id) return;
    const rs = Utils_combineDateTime(r.depart_date, r.depart_time);
    const re = Utils_combineDateTime(r.return_date, r.return_time);
    if (!rs || !re) return;
    if (Utils_rangesOverlap(start, end, rs, re)) busyDriverIds[r.driver_id] = true;
  });

  return allDrivers.filter(d => !busyDriverIds[d.id]);
}

/**
 * แปลง payload จาก frontend (ISO datetimes + type_pref)
 * → payload ของ Vehicle_availableOn (depart_date/time + return_date/time + type)
 */
function _availabilityPayloadIn(payload) {
  const toPair = (iso) => {
    if (!iso) return { date: '', time: '' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    const date = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
    const time = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm');
    return { date: date, time: time };
  };
  const s = toPair(payload.start_datetime);
  const e = toPair(payload.end_datetime);
  return {
    depart_date: payload.depart_date || s.date,
    depart_time: payload.depart_time || s.time,
    return_date: payload.return_date || e.date,
    return_time: payload.return_time || e.time,
    type:        payload.type || payload.type_pref || '',
    excludeRequestId: payload.excludeRequestId || payload.exclude_request_id || ''
  };
}
