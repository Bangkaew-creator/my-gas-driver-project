/**
 * ============================================================================
 *  Setup.gs — ติดตั้งระบบครั้งแรก
 *  รัน setupSystem() หนึ่งครั้งหลังแก้ Config.gs เสร็จ
 * ============================================================================
 */

/**
 * รันฟังก์ชันนี้ครั้งแรกเพื่อสร้างทุกชีตและ seed ข้อมูลตัวอย่าง
 */
function setupSystem() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'PASTE_YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('กรุณาแก้ SPREADSHEET_ID ในไฟล์ Config.gs ก่อน');
  }
  const ss = DB_ss();

  // 1) สร้างชีตและ header
  Object.keys(SCHEMA).forEach(sheetName => {
    let sh = ss.getSheetByName(sheetName);
    if (!sh) sh = ss.insertSheet(sheetName);
    const cols = SCHEMA[sheetName];
    sh.clear();
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.getRange(1, 1, 1, cols.length)
      .setFontWeight('bold')
      .setBackground('#1e293b')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, cols.length);
  });

  // ลบชีตเริ่มต้นถ้ามี
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  // 2) Seed ข้อมูลตั้งต้น
  _seedUsers();
  _seedVehicles();
  _seedDrivers();
  _seedSettings();

  // 3) Toast
  try { ss.toast('ติดตั้งระบบสำเร็จ — deploy เป็น Web App ได้เลย', 'Setup Complete', 10); } catch(e){}

  console.log('✅ Setup complete. Deploy as Web App to use.');
  return 'OK';
}

function _seedUsers() {
  // ถ้ามีข้อมูลแล้วไม่ต้อง seed ซ้ำ
  if (DB_count(SHEETS.USERS) > 0) return;

  const users = [
    { username: 'admin',    password: 'Admin@123',    fullname: 'ผู้ดูแลระบบ',       email: ADMIN_EMAIL,            department: 'IT',               position: 'Admin',         role: ROLES.ADMIN },
    { username: 'manager',  password: 'Manager@123',  fullname: 'นายสมชาย ขยันงาน',  email: 'manager@example.com',  department: 'ธุรการ',          position: 'ผู้จัดการยานพาหนะ', role: ROLES.MANAGER },
    { username: 'approver', password: 'Approver@123', fullname: 'นางสาวสมศรี อนุมัติดี', email: 'approver@example.com', department: 'ทั่วไป',      position: 'หัวหน้าฝ่าย',     role: ROLES.APPROVER },
    { username: 'user',     password: 'User@123',     fullname: 'นายทดสอบ ใช้งาน',   email: 'user@example.com',     department: 'ทั่วไป',          position: 'เจ้าหน้าที่',      role: ROLES.USER },
    { username: 'driver',   password: 'Driver@123',   fullname: 'นายขับ ดีมาก',      email: 'driver@example.com',   department: 'ธุรการ',          position: 'พนักงานขับรถ',    role: ROLES.DRIVER }
  ];

  users.forEach(u => {
    const salt = Utils_genSalt();
    DB_insert(SHEETS.USERS, {
      id: Utils_genId(),
      username: u.username,
      password_hash: Utils_hashPassword(u.password, salt),
      salt: salt,
      fullname: u.fullname,
      email: u.email,
      department: u.department,
      position: u.position,
      phone: '',
      role: u.role,
      status: 'active',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
  });
}

function _seedVehicles() {
  if (DB_count(SHEETS.VEHICLES) > 0) return;
  const vs = [
    { plate: 'กข 1234 กทม.', brand: 'Toyota',  model: 'Camry',     year: 2022, type: 'sedan',  seats: 5,  color: 'ขาว',   fuel: 'เบนซิน', mileage: 25000 },
    { plate: 'งจ 5678 กทม.', brand: 'Toyota',  model: 'Hilux Revo',year: 2021, type: 'pickup', seats: 5,  color: 'ดำ',    fuel: 'ดีเซล',  mileage: 58000 },
    { plate: 'ฉช 9012 กทม.', brand: 'Toyota',  model: 'Commuter',  year: 2023, type: 'van',    seats: 12, color: 'ขาว',   fuel: 'ดีเซล',  mileage: 12000 },
    { plate: 'ซฌ 3456 กทม.', brand: 'Honda',   model: 'CR-V',      year: 2022, type: 'suv',    seats: 7,  color: 'เทา',   fuel: 'เบนซิน', mileage: 33000 }
  ];
  vs.forEach(v => {
    DB_insert(SHEETS.VEHICLES, {
      id: Utils_genId(),
      plate_number: v.plate,
      brand: v.brand,
      model: v.model,
      year: v.year,
      type: v.type,
      seats: v.seats,
      color: v.color,
      fuel_type: v.fuel,
      current_mileage: v.mileage,
      status: VEHICLE_STATUS.AVAILABLE,
      notes: '',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
  });
}

function _seedDrivers() {
  if (DB_count(SHEETS.DRIVERS) > 0) return;
  const ds = [
    { code: 'DRV001', name: 'นายขับ ดีมาก',   license: '1-1234-56789-01-2', expiry: '2028-12-31', phone: '081-234-5678' },
    { code: 'DRV002', name: 'นายใจกลาง รอบคอบ', license: '1-2345-67890-12-3', expiry: '2027-06-30', phone: '082-345-6789' },
    { code: 'DRV003', name: 'นายปลอดภัย มือโปร', license: '1-3456-78901-23-4', expiry: '2029-03-15', phone: '083-456-7890' }
  ];
  ds.forEach(d => {
    DB_insert(SHEETS.DRIVERS, {
      id: Utils_genId(),
      employee_code: d.code,
      fullname: d.name,
      license_number: d.license,
      license_expiry: d.expiry,
      phone: d.phone,
      email: '',
      status: 'active',
      notes: '',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
  });
}

function _seedSettings() {
  if (DB_count(SHEETS.SETTINGS) > 0) return;
  const settings = [
    ['system.org_name',       ORG_NAME,    'ชื่อหน่วยงาน'],
    ['system.system_name',    SYSTEM_NAME, 'ชื่อระบบ'],
    ['notify.admin_email',    ADMIN_EMAIL, 'อีเมลผู้ดูแลระบบ'],
    ['notify.enable_email',   'true',      'เปิด/ปิด การส่งอีเมลแจ้งเตือน'],
    ['request.auto_no_format','REQ-YYYYMM-NNNN', 'รูปแบบเลขคำขอ'],
    ['workflow.approval_levels','2',       'จำนวนขั้นอนุมัติ'],
  ];
  settings.forEach(s => {
    DB_insert(SHEETS.SETTINGS, {
      id: Utils_genId(),
      key: s[0],
      value: s[1],
      description: s[2],
      updated_at: Utils_now()
    });
  });
}

/**
 * รีเซ็ตระบบ (อันตราย — ลบข้อมูลทั้งหมด)
 * ใช้เฉพาะตอนพัฒนา/ทดสอบ
 */
function resetSystem() {
  const ui = SpreadsheetApp.getUi ? SpreadsheetApp.getUi() : null;
  if (ui) {
    const resp = ui.alert('ยืนยันการรีเซ็ต', 'ข้อมูลทั้งหมดจะถูกลบ ต้องการดำเนินการต่อ?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
  }
  const ss = DB_ss();
  ss.getSheets().forEach(sh => ss.deleteSheet(sh));
  ss.insertSheet('temp');
  setupSystem();
}
