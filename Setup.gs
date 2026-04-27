/**
 * ============================================================================
 *  Setup.gs — ติดตั้งระบบครั้งแรก + ข้อมูลจำลองสำหรับทดสอบ
 *  รัน setupSystem() หนึ่งครั้งหลังแก้ Config.gs เสร็จ
 *  รัน resetSystem() เพื่อลบข้อมูลทั้งหมดและ seed ใหม่
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

  // 2) Seed ข้อมูลตั้งต้น (ลำดับ: divisions ก่อน เพราะ users/vehicles/drivers อ้างถึง)
  _seedDivisions();
  _seedUsers();
  _seedVehicles();
  _seedDrivers();
  _seedSettings();
  _seedDemoRequests();

  // 3) Toast
  try { ss.toast('ติดตั้งระบบสำเร็จ — เพิ่มข้อมูลจำลองแล้ว', 'Setup Complete', 10); } catch(e){}

  console.log('✅ Setup complete with demo data.');
  return 'OK';
}

function _seedDivisions() {
  if (DB_count(SHEETS.DIVISIONS) > 0) return;
  DEFAULT_DIVISIONS.forEach(d => {
    DB_insert(SHEETS.DIVISIONS, {
      id: Utils_genId(),
      code: d.code,
      name: d.name,
      active: 'true',
      created_at: Utils_now(),
      updated_at: Utils_now()
    });
  });
}

/**
 * คืน id ของกองตามชื่อ (ใช้ตอน seed)
 */
function _divIdByName(name) {
  const d = DB_findOne(SHEETS.DIVISIONS, { name: name });
  return d ? d.id : '';
}

function _seedUsers() {
  if (DB_count(SHEETS.USERS) > 0) return;

  // ชื่อกองสั้น ๆ ใช้บ่อย
  const HEALTH = 'กองสาธารณสุขและสิ่งแวดล้อม';  // กองทดสอบหลัก — มี 7 บทบาทครบ
  const ENG    = 'กองช่าง';                      // กองทดสอบรอง — มี 3 บทบาท
  const FIN    = 'กองคลัง';                      // มี director + requester
  const OFF    = 'สำนักปลัด';                    // มี requester

  const users = [
    // ----- กองสาธารณสุขและสิ่งแวดล้อม (กองทดสอบหลัก) -----
    { username: 'superadmin',    password: 'SuperAdmin@123', fullname: 'นายซุปเปอร์ แอดมิน',         email: ADMIN_EMAIL,                  position: 'ผู้ดูแลระบบ',         role: ROLES.SUPER_ADMIN, division: HEALTH },
    { username: 'divadmin',      password: 'DivAdmin@123',   fullname: 'นายแอดมิน กองสาธารณสุข',     email: 'divadmin@example.com',       position: 'แอดมินกอง',          role: ROLES.DIV_ADMIN,   division: HEALTH },
    { username: 'director',      password: 'Director@123',   fullname: 'นายผู้อำนวยการ ใจดี',         email: 'director@example.com',       position: 'ผอ.กองสาธารณสุขฯ',   role: ROLES.DIRECTOR,    division: HEALTH },
    { username: 'deputy',        password: 'Deputy@123',     fullname: 'นายปลัด รอบคอบ',             email: 'deputy@example.com',         position: 'ปลัดเทศบาล',         role: ROLES.DEPUTY,      division: HEALTH },
    { username: 'mayor',         password: 'Mayor@123',      fullname: 'นายกเทศมนตรี เมตตา',         email: 'mayor@example.com',          position: 'นายกเทศมนตรี',       role: ROLES.MAYOR,       division: HEALTH },
    { username: 'driver',        password: 'Driver@123',     fullname: 'นายขับ ดีมาก',               email: 'driver@example.com',         position: 'พนักงานขับรถ',       role: ROLES.DRIVER,      division: HEALTH },
    { username: 'requester',     password: 'Requester@123',  fullname: 'นายผู้ขอ ใช้รถ',             email: 'requester@example.com',      position: 'เจ้าหน้าที่',         role: ROLES.REQUESTER,   division: HEALTH },

    // ----- กองช่าง (สำหรับทดสอบ scoping ข้ามกอง) -----
    { username: 'divadmin_eng',  password: 'DivAdmin@123',   fullname: 'นายแอดมิน กองช่าง',           email: 'divadmin.eng@example.com',   position: 'แอดมินกองช่าง',     role: ROLES.DIV_ADMIN,   division: ENG },
    { username: 'director_eng',  password: 'Director@123',   fullname: 'นายผู้อำนวยการ กองช่าง',      email: 'director.eng@example.com',   position: 'ผอ.กองช่าง',         role: ROLES.DIRECTOR,    division: ENG },
    { username: 'requester_eng', password: 'Requester@123',  fullname: 'นายช่าง ขอใช้รถ',            email: 'requester.eng@example.com',  position: 'นายช่างโยธา',        role: ROLES.REQUESTER,   division: ENG },

    // ----- กองคลัง -----
    { username: 'director_fin',  password: 'Director@123',   fullname: 'นางผอ. กองคลัง',             email: 'director.fin@example.com',   position: 'ผอ.กองคลัง',         role: ROLES.DIRECTOR,    division: FIN },
    { username: 'requester_fin', password: 'Requester@123',  fullname: 'น.ส.เจ้าหน้าที่ การเงิน',     email: 'requester.fin@example.com',  position: 'การเงิน',            role: ROLES.REQUESTER,   division: FIN },

    // ----- สำนักปลัด -----
    { username: 'requester_off', password: 'Requester@123',  fullname: 'นายเจ้าหน้าที่ สำนักปลัด',     email: 'requester.off@example.com',  position: 'เจ้าหน้าที่ปลัด',    role: ROLES.REQUESTER,   division: OFF }
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
      department: u.division,
      division_id: _divIdByName(u.division),
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

  const HEALTH = 'กองสาธารณสุขและสิ่งแวดล้อม';
  const ENG    = 'กองช่าง';
  const FIN    = 'กองคลัง';
  const OFF    = 'สำนักปลัด';

  const vs = [
    // ---- กองสาธารณสุขและสิ่งแวดล้อม (4 คัน) ----
    { plate: 'กข 1234 กทม.', brand: 'Toyota',  model: 'Camry',     year: 2022, type: 'sedan',  seats: 5,  color: 'ขาว',     fuel: 'เบนซิน', mileage: 25000, division: HEALTH },
    { plate: 'งจ 5678 กทม.', brand: 'Toyota',  model: 'Hilux Revo',year: 2021, type: 'pickup', seats: 5,  color: 'ดำ',      fuel: 'ดีเซล',  mileage: 58000, division: HEALTH },
    { plate: 'ฉช 9012 กทม.', brand: 'Toyota',  model: 'Commuter',  year: 2023, type: 'van',    seats: 12, color: 'ขาว',     fuel: 'ดีเซล',  mileage: 12000, division: HEALTH },
    { plate: 'ซฌ 3456 กทม.', brand: 'Honda',   model: 'CR-V',      year: 2022, type: 'suv',    seats: 7,  color: 'เทา',     fuel: 'เบนซิน', mileage: 33000, division: HEALTH },

    // ---- กองช่าง (2 คัน) ----
    { plate: 'ญด 7777 กทม.', brand: 'Isuzu',   model: 'D-Max',     year: 2020, type: 'pickup', seats: 5,  color: 'น้ำเงิน', fuel: 'ดีเซล',  mileage: 75000, division: ENG },
    { plate: 'ฌบ 8888 กทม.', brand: 'Hino',    model: '300 Series',year: 2019, type: 'truck',  seats: 3,  color: 'เขียว',   fuel: 'ดีเซล',  mileage: 92000, division: ENG },

    // ---- กองคลัง (1 คัน) ----
    { plate: 'รบ 9999 กทม.', brand: 'Nissan',  model: 'Almera',    year: 2023, type: 'sedan',  seats: 5,  color: 'เงิน',    fuel: 'เบนซิน', mileage: 8500,  division: FIN },

    // ---- สำนักปลัด (2 คัน) ----
    { plate: 'สท 0001 กทม.', brand: 'Toyota',  model: 'Camry Hybrid', year: 2024, type: 'sedan', seats: 5,  color: 'ดำ',     fuel: 'ไฮบริด', mileage: 5000,  division: OFF },
    { plate: 'สท 0002 กทม.', brand: 'Toyota',  model: 'Hiace',        year: 2023, type: 'van',   seats: 14, color: 'ขาว',    fuel: 'ดีเซล',  mileage: 18000, division: OFF }
  ];

  vs.forEach(v => {
    DB_insert(SHEETS.VEHICLES, {
      id: Utils_genId(),
      plate_number: v.plate, brand: v.brand, model: v.model, year: v.year,
      type: v.type, seats: v.seats, color: v.color, fuel_type: v.fuel,
      current_mileage: v.mileage,
      division_id: _divIdByName(v.division),
      status: VEHICLE_STATUS.AVAILABLE, notes: '',
      created_at: Utils_now(), updated_at: Utils_now()
    });
  });
}

function _seedDrivers() {
  if (DB_count(SHEETS.DRIVERS) > 0) return;

  const HEALTH = 'กองสาธารณสุขและสิ่งแวดล้อม';
  const ENG    = 'กองช่าง';
  const OFF    = 'สำนักปลัด';

  const ds = [
    // กองสาธารณสุข (3 คน)
    { code: 'DRV001', name: 'นายขับ ดีมาก',         license: '1-1234-56789-01-2', expiry: '2028-12-31', phone: '081-234-5678', email: 'driver@example.com', division: HEALTH },
    { code: 'DRV002', name: 'นายใจกลาง รอบคอบ',    license: '1-2345-67890-12-3', expiry: '2027-06-30', phone: '082-345-6789', email: '',                   division: HEALTH },
    { code: 'DRV003', name: 'นายปลอดภัย มือโปร',   license: '1-3456-78901-23-4', expiry: '2029-03-15', phone: '083-456-7890', email: '',                   division: HEALTH },

    // กองช่าง (2 คน)
    { code: 'DRV101', name: 'นายสมศักดิ์ ขับช่าง',  license: '1-4567-89012-34-5', expiry: '2028-08-20', phone: '084-567-8901', email: '',                   division: ENG },
    { code: 'DRV102', name: 'นายมานพ ขับใหญ่',     license: '1-5678-90123-45-6', expiry: '2027-11-10', phone: '085-678-9012', email: '',                   division: ENG },

    // สำนักปลัด (2 คน)
    { code: 'DRV201', name: 'นายสุชาติ ขับนาย',    license: '1-6789-01234-56-7', expiry: '2029-05-22', phone: '086-789-0123', email: '',                   division: OFF },
    { code: 'DRV202', name: 'นายประยงค์ ขับ VIP',  license: '1-7890-12345-67-8', expiry: '2028-02-15', phone: '087-890-1234', email: '',                   division: OFF }
  ];

  ds.forEach(d => {
    DB_insert(SHEETS.DRIVERS, {
      id: Utils_genId(),
      employee_code: d.code, fullname: d.name, license_number: d.license,
      license_expiry: d.expiry, phone: d.phone, email: d.email,
      division_id: _divIdByName(d.division),
      status: 'active', notes: '',
      created_at: Utils_now(), updated_at: Utils_now()
    });
  });
}

function _seedSettings() {
  if (DB_count(SHEETS.SETTINGS) > 0) return;
  const settings = [
    ['system.org_name',        ORG_NAME,           'ชื่อหน่วยงาน'],
    ['system.system_name',     SYSTEM_NAME,        'ชื่อระบบ'],
    ['notify.admin_email',     ADMIN_EMAIL,        'อีเมลผู้ดูแลระบบ'],
    ['notify.enable_email',    'true',             'เปิด/ปิด การส่งอีเมลแจ้งเตือน'],
    ['request.auto_no_format', 'REQ-YYYYMM-NNNN',  'รูปแบบเลขคำขอ'],
    ['workflow.approval_levels','3',               'จำนวนขั้นอนุมัติ (ผอ.กอง → ปลัด → นายก)']
  ];
  settings.forEach(s => {
    DB_insert(SHEETS.SETTINGS, {
      id: Utils_genId(),
      key: s[0], value: s[1], description: s[2],
      updated_at: Utils_now()
    });
  });
}

/**
 * สร้างคำขอจำลอง 9 รายการ ครอบคลุมทุกสถานะ + 3 กอง
 * เพื่อทดสอบ A1 (data scoping + dashboard counters) ได้ครบทุกมุม
 */
function _seedDemoRequests() {
  if (DB_count(SHEETS.REQUESTS) > 0) return;

  // helpers
  const offsetDate = days => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
  };
  const ymPrefix = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMM');
  let seq = 1;
  const nextNo = () => 'REQ-' + ymPrefix + '-' + ('0000' + (seq++)).slice(-4);

  // ดึง user / vehicle / driver สำหรับใช้อ้างถึง
  const reqHealth   = DB_findOne(SHEETS.USERS, { username: 'requester' });
  const reqEng      = DB_findOne(SHEETS.USERS, { username: 'requester_eng' });
  const reqFin      = DB_findOne(SHEETS.USERS, { username: 'requester_fin' });
  const dirHealth   = DB_findOne(SHEETS.USERS, { username: 'director' });
  const dirEng      = DB_findOne(SHEETS.USERS, { username: 'director_eng' });
  const divadmin    = DB_findOne(SHEETS.USERS, { username: 'divadmin' });
  const divadminEng = DB_findOne(SHEETS.USERS, { username: 'divadmin_eng' });

  const driverHealthDB = DB_findOne(SHEETS.DRIVERS,  { fullname: 'นายขับ ดีมาก' });
  const driverEngDB    = DB_findOne(SHEETS.DRIVERS,  { employee_code: 'DRV101' });
  const vehHealthSedan = DB_findOne(SHEETS.VEHICLES, { plate_number: 'กข 1234 กทม.' });
  const vehHealthVan   = DB_findOne(SHEETS.VEHICLES, { plate_number: 'ฉช 9012 กทม.' });
  const vehEngPickup   = DB_findOne(SHEETS.VEHICLES, { plate_number: 'ญด 7777 กทม.' });

  if (!reqHealth) return; // safety

  const requests = [
    // R1: pending — กองสาธารณสุข
    { req: reqHealth, depart: 7, ret: 7, depTime: '08:00', retTime: '17:00',
      purpose: 'ลงพื้นที่ตรวจสุขลักษณะร้านอาหาร', dest: 'ตลาดสดบางแก้ว',
      passengers: 3, status: 'pending', level: 1, vehicle: null, driver: null,
      logs: [{ action: 'submit', level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' }] },

    // R2: approved_l1 (รอจัดสรร) — กองสาธารณสุข
    { req: reqHealth, depart: 5, ret: 5, depTime: '09:00', retTime: '16:00',
      purpose: 'ประชุมร่วมกับสำนักงานสาธารณสุขจังหวัด', dest: 'สสจ. สมุทรปราการ',
      passengers: 4, status: 'approved_l1', level: 2, vehicle: null, driver: null,
      logs: [
        { action: 'submit',  level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' },
        { action: 'approve', level: 1, by: dirHealth, comment: 'อนุมัติ' }
      ] },

    // R3: approved (จัดสรรแล้ว) — กองสาธารณสุข
    { req: reqHealth, depart: 3, ret: 3, depTime: '07:30', retTime: '12:00',
      purpose: 'รับ-ส่งเอกสารราชการ', dest: 'ศาลากลางจังหวัดสมุทรปราการ',
      passengers: 2, status: 'approved', level: 3, vehicle: vehHealthSedan, driver: driverHealthDB,
      logs: [
        { action: 'submit',  level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' },
        { action: 'approve', level: 1, by: dirHealth, comment: 'อนุมัติ' },
        { action: 'assign',  level: 2, by: divadmin,  comment: 'จัดสรรรถ Camry และคนขับ' }
      ] },

    // R4: in_progress (วันนี้) — กองสาธารณสุข
    { req: reqHealth, depart: 0, ret: 0, depTime: '08:00', retTime: '18:00',
      purpose: 'อบรมเจ้าหน้าที่ด้านสิ่งแวดล้อม', dest: 'โรงแรมในเมืองสมุทรปราการ',
      passengers: 8, status: 'in_progress', level: 3, vehicle: vehHealthVan, driver: driverHealthDB,
      logs: [
        { action: 'submit',  level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' },
        { action: 'approve', level: 1, by: dirHealth, comment: 'อนุมัติ' },
        { action: 'assign',  level: 2, by: divadmin,  comment: 'จัดสรรรถตู้ Commuter และคนขับ' },
        { action: 'start',   level: 3, by: divadmin,  comment: 'เริ่มเดินทาง เลขไมล์: 12000' }
      ] },

    // R5: completed (-5 วัน) — กองสาธารณสุข
    { req: reqHealth, depart: -5, ret: -5, depTime: '08:00', retTime: '15:00',
      purpose: 'จัดงานวันสิ่งแวดล้อมโลก', dest: 'สวนสาธารณะเมือง',
      passengers: 6, status: 'completed', level: 3, vehicle: vehHealthSedan, driver: driverHealthDB,
      logs: [
        { action: 'submit',   level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' },
        { action: 'approve',  level: 1, by: dirHealth, comment: 'อนุมัติ' },
        { action: 'assign',   level: 2, by: divadmin,  comment: 'จัดสรรรถและคนขับ' },
        { action: 'start',    level: 3, by: divadmin,  comment: 'เริ่มเดินทาง เลขไมล์: 24920' },
        { action: 'complete', level: 3, by: divadmin,  comment: 'เดินทางเสร็จสิ้น ระยะทาง: 80 กม.' }
      ] },

    // R6: rejected — กองสาธารณสุข
    { req: reqHealth, depart: 10, ret: 10, depTime: '13:00', retTime: '17:00',
      purpose: 'ทัศนศึกษานอกพื้นที่', dest: 'พระราม 9 กรุงเทพฯ',
      passengers: 8, status: 'rejected', level: 1, vehicle: null, driver: null,
      reject_reason: 'ไม่ได้ระบุงบประมาณและไม่อยู่ในแผนงานประจำปี',
      logs: [
        { action: 'submit', level: 0, by: reqHealth, comment: 'ยื่นคำขอใหม่' },
        { action: 'reject', level: 1, by: dirHealth, comment: 'ไม่ได้ระบุงบประมาณและไม่อยู่ในแผนงานประจำปี' }
      ] },

    // R7: pending — กองช่าง
    { req: reqEng, depart: 6, ret: 6, depTime: '08:00', retTime: '16:00',
      purpose: 'สำรวจไหล่ทางถนนชำรุด', dest: 'ถนนเทพารักษ์ กม. 12',
      passengers: 3, status: 'pending', level: 1, vehicle: null, driver: null,
      logs: [{ action: 'submit', level: 0, by: reqEng, comment: 'ยื่นคำขอใหม่' }] },

    // R8: approved (จัดสรรแล้ว) — กองช่าง
    { req: reqEng, depart: 4, ret: 4, depTime: '07:00', retTime: '17:00',
      purpose: 'ขนวัสดุก่อสร้างไปไซต์งาน', dest: 'ไซต์งานปรับปรุงถนนซอย 5',
      passengers: 2, status: 'approved', level: 3, vehicle: vehEngPickup, driver: driverEngDB,
      logs: [
        { action: 'submit',  level: 0, by: reqEng,       comment: 'ยื่นคำขอใหม่' },
        { action: 'approve', level: 1, by: dirEng,       comment: 'อนุมัติ' },
        { action: 'assign',  level: 2, by: divadminEng,  comment: 'จัดสรร D-Max และคนขับ' }
      ] },

    // R9: pending — กองคลัง
    { req: reqFin, depart: 8, ret: 8, depTime: '09:00', retTime: '15:00',
      purpose: 'รับฎีกาเบิกจ่ายและฝากธนาคาร', dest: 'ธนาคารออมสิน สาขาบางแก้ว',
      passengers: 1, status: 'pending', level: 1, vehicle: null, driver: null,
      logs: [{ action: 'submit', level: 0, by: reqFin, comment: 'ยื่นคำขอใหม่' }] }
  ];

  requests.forEach(r => {
    if (!r.req) return;
    const reqId = Utils_genId();
    DB_insert(SHEETS.REQUESTS, {
      id: reqId,
      request_no: nextNo(),
      requester_id: r.req.id,
      requester_name: r.req.fullname,
      department: r.req.department,
      division_id: r.req.division_id || '',
      position: r.req.position || '',
      phone: '',
      purpose: r.purpose,
      destination: r.dest,
      passengers_count: r.passengers,
      passenger_list: '',
      depart_date: offsetDate(r.depart), depart_time: r.depTime,
      return_date: offsetDate(r.ret),    return_time: r.retTime,
      vehicle_type_pref: '',
      vehicle_id:    r.vehicle ? r.vehicle.id : '',
      vehicle_plate: r.vehicle ? r.vehicle.plate_number : '',
      driver_id:     r.driver  ? r.driver.id : '',
      driver_name:   r.driver  ? r.driver.fullname : '',
      status: r.status,
      current_level: r.level,
      reject_reason: r.reject_reason || '',
      notes: '',
      created_at: Utils_now(), updated_at: Utils_now()
    });

    // approval logs
    (r.logs || []).forEach(log => {
      DB_insert(SHEETS.APPROVAL_LOGS, {
        id: Utils_genId(),
        request_id: reqId,
        approver_id:   log.by ? log.by.id : '',
        approver_name: log.by ? log.by.fullname : '',
        approver_role: log.by ? log.by.role : '',
        action: log.action,
        level: log.level,
        comment: log.comment || '',
        created_at: Utils_now()
      });
    });

    // trip log + vehicle status
    if (r.status === 'in_progress' && r.vehicle && r.driver) {
      DB_insert(SHEETS.TRIP_LOGS, {
        id: Utils_genId(),
        request_id: reqId,
        vehicle_id: r.vehicle.id,
        driver_id:  r.driver.id,
        start_mileage: r.vehicle.current_mileage || 0,
        end_mileage: '',
        distance: '',
        start_time: Utils_now(),
        end_time: '',
        notes: '',
        created_at: Utils_now()
      });
      DB_update(SHEETS.VEHICLES, r.vehicle.id, { status: VEHICLE_STATUS.IN_USE });
    } else if (r.status === 'completed' && r.vehicle && r.driver) {
      const startM = (Number(r.vehicle.current_mileage) || 80) - 80;
      const endM   = Number(r.vehicle.current_mileage)  || 80;
      DB_insert(SHEETS.TRIP_LOGS, {
        id: Utils_genId(),
        request_id: reqId,
        vehicle_id: r.vehicle.id,
        driver_id:  r.driver.id,
        start_mileage: startM,
        end_mileage: endM,
        distance: 80,
        start_time: Utils_now(),
        end_time: Utils_now(),
        notes: '',
        created_at: Utils_now()
      });
    }
  });
}

/**
 * รีเซ็ตระบบ — ลบทุกชีตและ seed ข้อมูลใหม่ (ใช้ตอนทดสอบ)
 */
function resetSystem() {
  const ui = (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getUi) ? SpreadsheetApp.getUi() : null;
  if (ui) {
    try {
      const resp = ui.alert('ยืนยันการรีเซ็ต',
        'ข้อมูลทั้งหมดจะถูกลบและ seed ใหม่พร้อมข้อมูลจำลอง ต้องการดำเนินการต่อหรือไม่?',
        ui.ButtonSet.YES_NO);
      if (resp !== ui.Button.YES) return;
    } catch (e) {}
  }

  const ss = DB_ss();
  // เพิ่มชีตชั่วคราวก่อน เพื่อให้สามารถลบชีตอื่นได้ทั้งหมด
  let temp = ss.getSheetByName('__temp_reset__');
  if (!temp) temp = ss.insertSheet('__temp_reset__');

  ss.getSheets().forEach(sh => {
    if (sh.getName() !== '__temp_reset__') {
      try { ss.deleteSheet(sh); } catch (e) {}
    }
  });

  setupSystem();

  try {
    const t = ss.getSheetByName('__temp_reset__');
    if (t && ss.getSheets().length > 1) ss.deleteSheet(t);
  } catch (e) {}

  console.log('✅ Reset complete with demo data.');
}
