/**
 * ============================================================================
 *  Utils.gs — ฟังก์ชันช่วยเหลือทั่วไป
 * ============================================================================
 */

// ---------- ID & Token ----------

/** สร้าง ID แบบสั้น (12 hex chars) */
function Utils_genId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

/** สร้าง token แบบยาวสำหรับ session (32 bytes = 64 hex) */
function Utils_genToken() {
  const bytes = [];
  for (let i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256));
  return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('');
}

/** สร้าง salt สำหรับ hash รหัสผ่าน */
function Utils_genSalt() {
  return Utils_genToken().substring(0, 16);
}

/** Hash รหัสผ่านด้วย SHA-256 + salt */
function Utils_hashPassword(password, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + ':' + salt,
    Utilities.Charset.UTF_8
  );
  return raw.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ---------- Request Number ----------

/**
 * สร้างเลขคำขอรูปแบบ REQ-YYYYMM-XXXX
 * เช่น REQ-202604-0001
 */
function Utils_genRequestNo() {
  const now = new Date();
  const ym = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMM');

  // นับคำขอในเดือนนี้
  const sheet = DB_sheet(SHEETS.REQUESTS);
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const rqNo = String(data[i][1] || '');
    if (rqNo.indexOf('REQ-' + ym) === 0) count++;
  }
  const seq = ('0000' + (count + 1)).slice(-4);
  return 'REQ-' + ym + '-' + seq;
}

// ---------- Date & Time ----------

/** วันที่ปัจจุบัน ISO */
function Utils_now() { return new Date().toISOString(); }

/** Format วันที่แบบไทย dd/MM/yyyy */
function Utils_formatDateTH(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy');
}

/** Format วันเวลาแบบไทย dd/MM/yyyy HH:mm */
function Utils_formatDateTimeTH(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
}

/** แปลง ISO string → Date object */
function Utils_parseDate(s) {
  if (!s) return null;
  return (s instanceof Date) ? s : new Date(s);
}

/** รวม date + time string เป็น Date
 *  - รับได้ทั้ง dateStr (yyyy-MM-dd) หรือ Date object (Sheets อาจ auto-parse)
 *  - รับ timeStr เช่น "08:00" หรือ Date object
 *  - คืน null ถ้าได้วันที่ไม่ valid (ป้องกัน toISOString throw)
 */
function Utils_combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  // Normalize date part → yyyy-MM-dd
  let datePart;
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    datePart = Utilities.formatDate(dateStr, 'Asia/Bangkok', 'yyyy-MM-dd');
  } else {
    datePart = String(dateStr).slice(0, 10);  // "2026-04-21T00:..." → "2026-04-21"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  }
  // Normalize time part → HH:mm
  let timePart = '00:00';
  if (timeStr instanceof Date) {
    if (!isNaN(timeStr.getTime())) timePart = Utilities.formatDate(timeStr, 'Asia/Bangkok', 'HH:mm');
  } else if (timeStr) {
    const m = String(timeStr).match(/(\d{1,2}):(\d{2})/);
    if (m) timePart = ('0' + m[1]).slice(-2) + ':' + m[2];
  }
  const d = new Date(datePart + 'T' + timePart + ':00+07:00');
  return isNaN(d.getTime()) ? null : d;
}

/** ตรวจว่าสองช่วงเวลาทับซ้อนหรือไม่ */
function Utils_rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// ---------- Validation ----------

function Utils_isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

function Utils_required(obj, fields) {
  const missing = [];
  fields.forEach(f => {
    if (obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '') missing.push(f);
  });
  return missing;
}

// ---------- Logging ----------

function Utils_logError(action, e) {
  console.error('[API ERROR]', action, e && e.stack ? e.stack : e);
}

function Utils_audit(userId, username, action, entity, entityId, detail) {
  try {
    DB_insert(SHEETS.AUDIT_LOGS, {
      id: Utils_genId(),
      user_id: userId || '',
      username: username || '',
      action: action || '',
      entity: entity || '',
      entity_id: entityId || '',
      detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail || ''),
      created_at: Utils_now()
    });
  } catch (e) {
    console.error('audit fail', e);
  }
}

// ---------- Sanitize ----------

/** ลบฟิลด์อ่อนไหวก่อนส่งกลับ client */
function Utils_stripUser(user) {
  if (!user) return null;
  const copy = Object.assign({}, user);
  delete copy.password_hash;
  delete copy.salt;
  return copy;
}

/** Escape HTML (กันกรณี server render) */
function Utils_escapeHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
