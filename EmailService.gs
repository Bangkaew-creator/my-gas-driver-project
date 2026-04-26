/**
 * ============================================================================
 *  EmailService.gs — ส่งอีเมลแจ้งเตือน
 *  เปิด/ปิดได้ที่ Settings key = notify.enable_email
 * ============================================================================
 */

function Email_isEnabled() {
  return DB_getSetting('notify.enable_email', 'true') === 'true';
}

function _sendEmail(to, subject, htmlBody) {
  if (!Email_isEnabled()) return;
  if (!to || !Utils_isEmail(to)) return;

  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: htmlBody,
      name: SYSTEM_NAME
    });
    DB_insert(SHEETS.NOTIFICATIONS, {
      id: Utils_genId(),
      to_email: to,
      subject: subject,
      body: htmlBody.substring(0, 500),
      status: 'sent',
      error: '',
      created_at: Utils_now()
    });
  } catch (e) {
    DB_insert(SHEETS.NOTIFICATIONS, {
      id: Utils_genId(),
      to_email: to,
      subject: subject,
      body: htmlBody.substring(0, 500),
      status: 'failed',
      error: e.message || String(e),
      created_at: Utils_now()
    });
  }
}

// ---------- template layout ----------

function _wrap(content) {
  return `
    <div style="font-family:Sarabun,Helvetica,sans-serif;background:#f1f5f9;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:20px 24px;">
          <div style="font-size:14px;opacity:.8;letter-spacing:.04em;">${Utils_escapeHtml(ORG_NAME)}</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">${Utils_escapeHtml(SYSTEM_NAME)}</div>
        </div>
        <div style="padding:24px;color:#1e293b;line-height:1.7;">${content}</div>
        <div style="border-top:1px solid #e2e8f0;padding:14px 24px;font-size:12px;color:#94a3b8;text-align:center;">
          อีเมลนี้ส่งอัตโนมัติจาก ${Utils_escapeHtml(SYSTEM_NAME)} — กรุณาอย่าตอบกลับ
        </div>
      </div>
    </div>`;
}

function _reqSummaryHtml(req) {
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">
      <tr><td style="padding:6px 0;color:#64748b;width:130px;">เลขคำขอ</td><td style="padding:6px 0;font-weight:600;">${Utils_escapeHtml(req.request_no)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">ผู้ขอ</td><td style="padding:6px 0;">${Utils_escapeHtml(req.requester_name)} (${Utils_escapeHtml(req.department)})</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">วัตถุประสงค์</td><td style="padding:6px 0;">${Utils_escapeHtml(req.purpose)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">ปลายทาง</td><td style="padding:6px 0;">${Utils_escapeHtml(req.destination)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">วันเวลาออก</td><td style="padding:6px 0;">${Utils_escapeHtml(req.depart_date + ' ' + req.depart_time)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">วันเวลากลับ</td><td style="padding:6px 0;">${Utils_escapeHtml(req.return_date + ' ' + req.return_time)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">จำนวนผู้โดยสาร</td><td style="padding:6px 0;">${Utils_escapeHtml(String(req.passengers_count))} คน</td></tr>
    </table>`;
}

// ---------- ชนิดการแจ้งเตือน ----------

function Email_notifyNewRequest(req) {
  // ส่งหาหัวหน้าแผนกเดียวกัน (หา user role=approver ในแผนกนั้น)
  const approvers = DB_findAll(SHEETS.USERS, { where: { role: ROLES.APPROVER, status: 'active' } });
  const recipients = approvers.filter(a => a.department === req.department).map(a => a.email);
  // ถ้าไม่มีหัวหน้าแผนก → ส่ง admin
  if (!recipients.length) {
    const admins = DB_findAll(SHEETS.USERS, { where: { role: ROLES.ADMIN, status: 'active' } });
    admins.forEach(a => recipients.push(a.email));
  }
  const content = `
    <h3 style="margin:0 0 12px;color:#1e293b;">📩 คำขอใช้รถใหม่รออนุมัติ</h3>
    <p>มีคำขอใช้รถใหม่จาก <b>${Utils_escapeHtml(req.requester_name)}</b> รอการอนุมัติขั้นที่ 1 (หัวหน้าแผนก)</p>
    ${_reqSummaryHtml(req)}
    <p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่ออนุมัติคำขอ</p>`;
  recipients.forEach(to => _sendEmail(to, '[คำขอใหม่] ' + req.request_no + ' – ' + req.requester_name, _wrap(content)));
}

function Email_notifyApprovalL1(req) {
  // ส่งหา manager ทุกคน
  const managers = DB_findAll(SHEETS.USERS, { where: { role: ROLES.MANAGER, status: 'active' } });
  const content = `
    <h3 style="margin:0 0 12px;color:#1e293b;">✅ คำขอผ่านอนุมัติขั้นที่ 1</h3>
    <p>คำขอได้รับอนุมัติจากหัวหน้าแผนกแล้ว รอการจัดสรรรถและคนขับ</p>
    ${_reqSummaryHtml(req)}
    <p style="margin-top:16px;color:#64748b;">กรุณาเข้าระบบเพื่อจัดสรรรถและคนขับ</p>`;
  managers.forEach(m => _sendEmail(m.email, '[รอจัดสรรรถ] ' + req.request_no, _wrap(content)));
}

function Email_notifyApproved(req) {
  // แจ้งผู้ขอ + คนขับ
  const requester = DB_findById(SHEETS.USERS, req.requester_id);
  const driver = DB_findById(SHEETS.DRIVERS, req.driver_id);

  const contentReq = `
    <h3 style="margin:0 0 12px;color:#10b981;">🎉 คำขอของคุณได้รับการอนุมัติแล้ว</h3>
    <p>รถและคนขับที่จัดสรร:</p>
    <table style="width:100%;border-collapse:collapse;background:#f0fdf4;border-radius:8px;padding:8px;">
      <tr><td style="padding:8px 12px;color:#64748b;">ทะเบียนรถ</td><td style="padding:8px 12px;font-weight:600;">${Utils_escapeHtml(req.vehicle_plate)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">คนขับ</td><td style="padding:8px 12px;font-weight:600;">${Utils_escapeHtml(req.driver_name)}</td></tr>
    </table>
    ${_reqSummaryHtml(req)}`;

  if (requester) _sendEmail(requester.email, '[อนุมัติแล้ว] ' + req.request_no, _wrap(contentReq));

  if (driver && driver.email) {
    const contentDriver = `
      <h3 style="margin:0 0 12px;color:#3b82f6;">🚗 คุณถูกมอบหมายงานขับรถใหม่</h3>
      ${_reqSummaryHtml(req)}
      <p style="margin-top:16px;color:#64748b;">กรุณาตรวจสอบรายละเอียดและเข้าระบบเพื่อบันทึกเลขไมล์เมื่อเริ่มเดินทาง</p>`;
    _sendEmail(driver.email, '[งานใหม่] ' + req.request_no + ' – ' + req.destination, _wrap(contentDriver));
  }
}

function Email_notifyRejected(req, reason) {
  const requester = DB_findById(SHEETS.USERS, req.requester_id);
  if (!requester) return;
  const content = `
    <h3 style="margin:0 0 12px;color:#ef4444;">❌ คำขอของคุณไม่ได้รับการอนุมัติ</h3>
    ${_reqSummaryHtml(req)}
    <div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;">
      <div style="font-size:12px;color:#64748b;">เหตุผล</div>
      <div style="margin-top:4px;color:#991b1b;">${Utils_escapeHtml(reason)}</div>
    </div>`;
  _sendEmail(requester.email, '[ไม่อนุมัติ] ' + req.request_no, _wrap(content));
}
