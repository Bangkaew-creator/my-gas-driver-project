/**
 * ============================================================================
 *  Database.gs — Generic CRUD สำหรับ Google Sheets
 *  ใช้ SCHEMA จาก Config.gs เพื่อ map object ↔ row
 *  ใช้ LockService กันการเขียนชนกัน
 * ============================================================================
 */

// ---------- Access helpers ----------

function DB_ss() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function DB_sheet(name) {
  const sh = DB_ss().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name + ' (รัน setupSystem ก่อน)');
  return sh;
}

function DB_cols(sheetName) {
  return SCHEMA[sheetName] || [];
}

// ---------- Core CRUD ----------

/**
 * ดึงข้อมูลทั้งหมดของชีต → array ของ object
 * option: { where: { field: value | function } }
 */
function DB_findAll(sheetName, opt) {
  opt = opt || {};
  const sheet = DB_sheet(sheetName);
  const cols = DB_cols(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const range = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  const rows = [];
  for (let r = 0; r < range.length; r++) {
    const row = range[r];
    // skip empty row
    if (row.every(v => v === '' || v === null)) continue;
    const obj = {};
    for (let c = 0; c < cols.length; c++) {
      obj[cols[c]] = row[c];
    }
    obj.__row = r + 2; // เก็บ row index ไว้ใช้ update/delete
    rows.push(obj);
  }

  if (opt.where) {
    return rows.filter(row => _matchWhere(row, opt.where));
  }
  return rows;
}

function _matchWhere(row, where) {
  for (const k in where) {
    const v = where[k];
    if (typeof v === 'function') {
      if (!v(row[k], row)) return false;
    } else if (Array.isArray(v)) {
      if (v.indexOf(row[k]) < 0) return false;
    } else {
      if (row[k] !== v) return false;
    }
  }
  return true;
}

/** ดึง record เดียวตาม id */
function DB_findById(sheetName, id) {
  const rows = DB_findAll(sheetName, { where: { id: id } });
  return rows.length ? rows[0] : null;
}

/** ดึง record เดียวตาม field */
function DB_findOne(sheetName, where) {
  const rows = DB_findAll(sheetName, { where: where });
  return rows.length ? rows[0] : null;
}

/**
 * เพิ่ม record ใหม่
 * - object ต้องมี id (ถ้าไม่มีจะสร้างให้)
 * - auto add created_at ถ้าชีตมีคอลัมน์นี้และ value ว่าง
 */
function DB_insert(sheetName, obj) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cols = DB_cols(sheetName);
    const data = Object.assign({}, obj);
    if (cols.indexOf('id') >= 0 && !data.id) data.id = Utils_genId();
    if (cols.indexOf('created_at') >= 0 && !data.created_at) data.created_at = Utils_now();

    const row = cols.map(c => data[c] !== undefined ? data[c] : '');
    DB_sheet(sheetName).appendRow(row);
    return data;
  } finally {
    lock.releaseLock();
  }
}

/**
 * อัพเดต record ตาม id
 */
function DB_update(sheetName, id, patch) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cols = DB_cols(sheetName);
    const existing = DB_findById(sheetName, id);
    if (!existing) throw new Error('ไม่พบข้อมูล id=' + id + ' ในชีต ' + sheetName);

    const data = Object.assign({}, existing, patch);
    if (cols.indexOf('updated_at') >= 0) data.updated_at = Utils_now();

    const row = cols.map(c => data[c] !== undefined ? data[c] : '');
    DB_sheet(sheetName).getRange(existing.__row, 1, 1, cols.length).setValues([row]);
    data.__row = existing.__row;
    return data;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ลบ record ตาม id (ลบ row จริง)
 */
function DB_delete(sheetName, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existing = DB_findById(sheetName, id);
    if (!existing) return false;
    DB_sheet(sheetName).deleteRow(existing.__row);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** นับ records */
function DB_count(sheetName, where) {
  return DB_findAll(sheetName, { where: where }).length;
}

// ---------- Setting get/set ----------

function DB_getSetting(key, defaultValue) {
  const row = DB_findOne(SHEETS.SETTINGS, { key: key });
  return row ? row.value : (defaultValue !== undefined ? defaultValue : null);
}

function DB_setSetting(key, value, description) {
  const row = DB_findOne(SHEETS.SETTINGS, { key: key });
  if (row) {
    DB_update(SHEETS.SETTINGS, row.id, {
      value: value,
      updated_at: Utils_now()
    });
  } else {
    DB_insert(SHEETS.SETTINGS, {
      id: Utils_genId(),
      key: key,
      value: value,
      description: description || '',
      updated_at: Utils_now()
    });
  }
}
