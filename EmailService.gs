/**
 * ============================================================================
 *  EmailService.gs — ส่งอีเมลแจ้งเตือน (3-level approval workflow)
 *  เปิด/ปิดได้ที่ Settings key = notify.enable_email
 * ============================================================================
 */

function Email_isEnabled() {
  return DB_getSetting('notify.enable_email', 'false') === 'true';
}

function _sendEmail(to, subject, htmlBody) {
  if (!Email_isEnabled()) return;
  if (!to || !Utils_isEmail(to)) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody, name: SYSTEM_NAME });
    DB_insert(SHEETS.NOTIFICATIONS, {
      id: Utils_genId(), to_email: to, subject: subject,
      body: htmlBody.substring(0, 500), status: 'sent', error: '',
      created_at: Utils_now()
    });
  } catch (e) {
    DB_insert(SHEETS.NOTIFICATIONS, {
      id: Utils_genId(), to_email: to, subject: subject,
      body: htmlBody.substring(0, 500), status: 'failed',
      error: e.message || String(e), created_at: Utils_now()
    });
  }
}

// ---------- Template ----------

function _wrap(content) {
  return '<div style="font-family:Sarabun,Helvetica,sans-serif;background:#f1f5f9;padding:24px;">'
    + '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">'
    + '<div style="background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:20px 24px;">'
    + '<div style="font-size:14px;opacity:.8;">' + Utils_escapeHtml(ORG_NAME) + '</div>'
    + '<div style="font-size:20px;font-weight:700;margin-top:4px;">' + Utils_escapeHtml(SYSTEM_NAME) + '</div>'
    + '</div>'
    + '<div style="padding:24px;color:#1e293b;line-height:1.7;">' + content + '</div>'
    + '<div style="border-top:1px solid #e2e8f0;padding:14px 24px;font-size:12px;color:#94a3b8;text-align:center;">'
    + 'อีเมลนี้ส่งอัตโนมัติจาก ' + Utils_escapeHtml(SYSTEM_NAME) + ' — กรุณาอย่าตอบกลับ'
    + '</div></div></div>';
}

function _reqSummaryHtml(req) {
  return '<table style="width:100%;border-collapse:collapse;margin-top:8px;">'
    + '<tr><td style="padding:6px 0;color:#64748b;width:130px;">เลขคำขอ</td><td style="padding:6px 0;font-weight:600;">' + Utils_escapeHtml(req.request_no) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">ผู้ขอ</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.requester_name) + ' (' + Utils_escapeHtml(req.department || '') + ')</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">วัตถุประสงค์</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.purpose) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">ปลายทาง</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.destination) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">วันเวลาออก</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.depart_date + ' ' + req.depart_time) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">วันเวลากลับ</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.return_date + ' ' + req.return_time) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">ผู้โดยสาร</td><td style="padding:6px 0;">' + Utils_escapeHtml(String(req.passengers_count)) + ' คน</td></tr>'
    + '<tr><td style="padding:6px 0;color:#64748b;">รถ / คนขับ</td><td style="padding:6px 0;">' + Utils_escapeHtml(req.vehicle_plate || '-') + ' / ' + Utils_escapeHtml(req.driver_name || '-') + '</td></tr>'
    + '</table>';
}

// ---------- ชนิดการแจ้งเตือน ----------

// แจ้ง director ในกองเดียวกัน เมื่อมีคำขอใหม่ (รอ L1)
function Email_notifyNewRequest(req) {
  if (!Email_isEnabled()) return;
  var directors = DB_findAll(SHEETS.USERS, { where: { role: ROLES.DIRECTOR, status: 'active' } })
    .filter(function(u) { return !req.division_id || u.division_id === req.division_id; });
  if (!directors.length) {
    directors = DB_findAll(SHEETS.USERS, { where: { role: ROLES.SUPER_ADMIN, status: 'active' } });
  }
  var content = '<h3 style="margin:0 0 12px;color:#1e293b;">คำขอใช้รถใหม่รออนุมัติ (ขั้น 1)</h3>'
    + '<p>มีคำขอใช้รถใหม่จาก <b>' + Utils_escapeHtml(req.requester_name) + '</b> รอการอนุมัติขั้น 1 (ผอ.กอง)</p>'
    + _reqSummaryHtml(req)
    + '<p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่ออนุมัติคำขอ</p>';
  var subj = '[คำขอใหม่] ' + req.request_no + ' – ' + req.requester_name;
  directors.forEach(function(u) { _sendEmail(u.email, subj, _wrap(content)); });
}

// แจ้ง deputy เมื่อ L1 อนุมัติ (รอ L2)
function Email_notifyApprovalL1(req) {
  if (!Email_isEnabled()) return;
  var deputies = DB_findAll(SHEETS.USERS, { where: { role: ROLES.DEPUTY, status: 'active' } });
  var content = '<h3 style="margin:0 0 12px;color:#1e293b;">คำขอผ่านอนุมัติขั้น 1 — รออนุมัติขั้น 2</h3>'
    + '<p>คำขอได้รับอนุมัติจาก <b>ผอ.กอง</b> แล้ว รอการอนุมัติขั้น 2 (ปลัดเทศบาล)</p>'
    + _reqSummaryHtml(req)
    + '<p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่ออนุมัติคำขอ</p>';
  var subj = '[รอ L2] ' + req.request_no + ' – ' + req.purpose;
  deputies.forEach(function(u) { _sendEmail(u.email, subj, _wrap(content)); });
}

// แจ้ง mayor เมื่อ L2 อนุมัติ (รอ L3)
function Email_notifyApprovalL2(req) {
  if (!Email_isEnabled()) return;
  var mayors = DB_findAll(SHEETS.USERS, { where: { role: ROLES.MAYOR, status: 'active' } });
  var content = '<h3 style="margin:0 0 12px;color:#1e293b;">คำขอผ่านอนุมัติขั้น 2 — รออนุมัติขั้น 3</h3>'
    + '<p>คำขอได้รับอนุมัติจาก <b>ปลัดเทศบาล</b> แล้ว รอการอนุมัติขั้น 3 (นายกเทศมนตรี)</p>'
    + _reqSummaryHtml(req)
    + '<p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่ออนุมัติคำขอ</p>';
  var subj = '[รอ L3] ' + req.request_no + ' – ' + req.purpose;
  mayors.forEach(function(u) { _sendEmail(u.email, subj, _wrap(content)); });
}

// แจ้งผู้ขอ + คนขับ เมื่ออนุมัติครบ L3
function Email_notifyApproved(req) {
  if (!Email_isEnabled()) return;
  var requester = DB_findById(SHEETS.USERS, req.requester_id);
  var driver    = req.driver_id ? DB_findById(SHEETS.DRIVERS, req.driver_id) : null;
  var contentReq = '<h3 style="margin:0 0 12px;color:#10b981;">คำขอของคุณได้รับการอนุมัติแล้ว</h3>'
    + _reqSummaryHtml(req)
    + '<p style="margin-top:16px;color:#64748b;">กรุณาพร้อมออกเดินทางตามกำหนด</p>';
  if (requester) _sendEmail(requester.email, '[อนุมัติแล้ว] ' + req.request_no, _wrap(contentReq));
  if (driver && driver.email) {
    var contentDrv = '<h3 style="margin:0 0 12px;color:#3b82f6;">คุณถูกมอบหมายงานขับรถ</h3>'
      + _reqSummaryHtml(req)
      + '<p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่อบันทึกเลขไมล์เมื่อเริ่มเดินทาง</p>';
    _sendEmail(driver.email, '[งานใหม่] ' + req.request_no + ' – ' + req.destination, _wrap(contentDrv));
  }
}

// แจ้งผู้ขอ เมื่อถูกปฏิเสธ
function Email_notifyRejected(req, reason, level) {
  if (!Email_isEnabled()) return;
  var requester = DB_findById(SHEETS.USERS, req.requester_id);
  if (!requester) return;
  var lvlTh = level === 1 ? 'ผอ.กอง (L1)' : level === 2 ? 'ปลัดเทศบาล (L2)' : level === 3 ? 'นายกเทศมนตรี (L3)' : '';
  var content = '<h3 style="margin:0 0 12px;color:#ef4444;">คำขอของคุณไม่ได้รับการอนุมัติ</h3>'
    + _reqSummaryHtml(req)
    + '<div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;">'
    + '<div style="font-size:12px;color:#64748b;">ปฏิเสธโดย ' + Utils_escapeHtml(lvlTh) + '</div>'
    + '<div style="margin-top:4px;color:#991b1b;">' + Utils_escapeHtml(reason || '') + '</div>'
    + '</div>';
  _sendEmail(requester.email, '[ไม่อนุมัติ] ' + req.request_no, _wrap(content));
}
