/**
 * ============================================================================
 *  DivisionService.gs — จัดการกอง (Divisions)
 * ============================================================================
 */

function Division_list(session, payload) {
  payload = payload || {};
  let rows = DB_findAll(SHEETS.DIVISIONS);
  if (payload.active != null) {
    rows = rows.filter(function(d) { return String(d.active) === String(payload.active); });
  }
  rows.sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); });
  return ok(rows);
}

function Division_get(session, id) {
  const d = DB_findById(SHEETS.DIVISIONS, id);
  if (!d) return err('not_found', 'ไม่พบกอง');
  return ok(d);
}

function Division_save(session, payload) {
  if (!Auth_isSuperAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบสูงสุด');
  const missing = Utils_required(payload, ['code', 'name']);
  if (missing.length) return err('invalid_input', 'กรุณากรอก: ' + missing.join(', '));

  const code = String(payload.code).trim().toUpperCase();
  const name = String(payload.name).trim();

  if (payload.id) {
    const existing = DB_findById(SHEETS.DIVISIONS, payload.id);
    if (!existing) return err('not_found', 'ไม่พบกองที่ต้องการแก้ไข');
    const dup = DB_findOne(SHEETS.DIVISIONS, function(d) {
      return d.code === code && d.id !== payload.id;
    });
    if (dup) return err('conflict', 'รหัสกอง ' + code + ' ซ้ำกับกองอื่น');
    const updated = DB_update(SHEETS.DIVISIONS, payload.id, {
      code: code,
      name: name,
      active: payload.active != null ? payload.active : existing.active,
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'division.update', 'division', payload.id, '');
    return ok(updated);
  } else {
    const dup = DB_findOne(SHEETS.DIVISIONS, function(d) { return d.code === code; });
    if (dup) return err('conflict', 'รหัสกอง ' + code + ' มีอยู่แล้ว');
    const created = DB_insert(SHEETS.DIVISIONS, {
      id: Utils_genId(),
      code: code,
      name: name,
      active: payload.active != null ? payload.active : true,
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
    Utils_audit(session.userId, session.username, 'division.create', 'division', created.id, '');
    return ok(created);
  }
}

function Division_delete(session, id) {
  if (!Auth_isSuperAdmin(session)) return err('forbidden', 'เฉพาะผู้ดูแลระบบสูงสุด');
  if (!id) return err('invalid_input', 'ต้องระบุ id');
  const existing = DB_findById(SHEETS.DIVISIONS, id);
  if (!existing) return err('not_found', 'ไม่พบกอง');
  const usersInDiv = DB_findOne(SHEETS.USERS, function(u) { return u.division_id === id; });
  if (usersInDiv) return err('conflict', 'ไม่สามารถลบได้ มีผู้ใช้งานอยู่ในกองนี้');
  const vehiclesInDiv = DB_findOne(SHEETS.VEHICLES, function(v) { return v.division_id === id; });
  if (vehiclesInDiv) return err('conflict', 'ไม่สามารถลบได้ มีรถอยู่ในกองนี้');
  const driversInDiv = DB_findOne(SHEETS.DRIVERS, function(d) { return d.division_id === id; });
  if (driversInDiv) return err('conflict', 'ไม่สามารถลบได้ มีคนขับอยู่ในกองนี้');
  DB_delete(SHEETS.DIVISIONS, id);
  Utils_audit(session.userId, session.username, 'division.delete', 'division', id, '');
  return ok(true);
}
