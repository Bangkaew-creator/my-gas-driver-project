/**
 * ============================================================================
 *  Config.gs
 *  ค่าคงที่ของระบบทั้งหมด — แก้ไขที่นี่จุดเดียว
 * ============================================================================
 */

// ---------- ข้อมูลระบบ (แก้ตรงนี้ก่อน deploy) ----------
const SPREADSHEET_ID = '16lKdCImYFHXhYZy4dKD7BE-VG0Qv2c5J-5ymSoFhlB4';
const ADMIN_EMAIL    = 'phd02bangknew@gmail.com';
const ORG_NAME       = 'เทศบาลเมืองบางแก้ว';
const SYSTEM_NAME    = 'ระบบขอใช้รถราชการ';

// ---------- ชื่อชีตในฐานข้อมูล ----------
const SHEETS = {
  DIVISIONS:     'Divisions',
  USERS:         'Users',
  VEHICLES:      'Vehicles',
  DRIVERS:       'Drivers',
  REQUESTS:      'Requests',
  APPROVAL_LOGS: 'ApprovalLogs',
  TRIP_LOGS:     'TripLogs',
  FUEL_LOGS:     'FuelLogs',
  MAINT_LOGS:    'MaintenanceLogs',
  NOTIFICATIONS: 'Notifications',
  SETTINGS:      'Settings',
  AUDIT_LOGS:    'AuditLogs'
};

// ---------- กอง (Divisions) ค่าเริ่มต้น 8 กอง ----------
const DEFAULT_DIVISIONS = [
  { code: 'OFFICE',     name: 'สำนักปลัด' },
  { code: 'FINANCE',    name: 'กองคลัง' },
  { code: 'ENGINEER',   name: 'กองช่าง' },
  { code: 'HEALTH',     name: 'กองสาธารณสุขและสิ่งแวดล้อม' },
  { code: 'EDUCATION',  name: 'กองการศึกษา' },
  { code: 'PERSONNEL',  name: 'กองการเจ้าหน้าที่' },
  { code: 'STRATEGY',   name: 'กองยุทธศาสตร์และงบประมาณ' },
  { code: 'WELFARE',    name: 'กองสวัสดิการสังคม' }
];

// ---------- โครงสร้างคอลัมน์ (schema) ----------
const SCHEMA = {
  [SHEETS.DIVISIONS]: [
    'id','code','name','active','created_at','updated_at'
  ],
  [SHEETS.USERS]: [
    'id','username','password_hash','salt','fullname','email',
    'department','division_id','position','phone','role','signature','status','created_at','updated_at'
  ],
  [SHEETS.VEHICLES]: [
    'id','plate_number','brand','model','year','type','seats','color',
    'fuel_type','current_mileage','division_id','status','notes','created_at','updated_at'
  ],
  [SHEETS.DRIVERS]: [
    'id','employee_code','fullname','license_number','license_expiry',
    'phone','email','division_id','status','notes','created_at','updated_at'
  ],
  [SHEETS.REQUESTS]: [
    'id','request_no','requester_id','requester_name','department','division_id','position','phone',
    'purpose','destination','passengers_count','passenger_list',
    'depart_date','depart_time','return_date','return_time',
    'vehicle_type_pref','vehicle_id','vehicle_plate','driver_id','driver_name',
    'status','current_level','reject_reason','notes','created_at','updated_at'
  ],
  [SHEETS.APPROVAL_LOGS]: [
    'id','request_id','approver_id','approver_name','approver_role',
    'action','level','comment','created_at'
  ],
  [SHEETS.TRIP_LOGS]: [
    'id','request_id','vehicle_id','driver_id',
    'start_mileage','end_mileage','distance',
    'start_time','end_time','notes','created_at'
  ],
  [SHEETS.FUEL_LOGS]: [
    'id','vehicle_id','driver_id','date','liters','cost_per_liter','total_cost',
    'mileage','receipt_no','notes','created_at'
  ],
  [SHEETS.MAINT_LOGS]: [
    'id','vehicle_id','date','type','description','cost','vendor','next_due','notes','created_at'
  ],
  [SHEETS.NOTIFICATIONS]: [
    'id','to_email','subject','body','status','error','created_at'
  ],
  [SHEETS.SETTINGS]: ['key','value','description','updated_at'],
  [SHEETS.AUDIT_LOGS]: ['id','user_id','username','action','entity','entity_id','detail','created_at']
};

// ---------- Role (บทบาท) — 7 บทบาท ----------
// ค่าใหม่ + alias เพื่อความเข้ากันได้กับโค้ดเดิม (จะถูก rewrite ในเฟส B1)
const ROLES = {
  SUPER_ADMIN: 'super_admin', // 1. ซุปเปอร์แอดมิน — สิทธิ์เต็ม เห็นทุกกอง
  DIV_ADMIN:   'div_admin',   // 2. แอดมินระดับกอง — จัดการเฉพาะข้อมูลกองตัวเอง
  DIRECTOR:    'director',    // 3. ผู้อำนวยการกอง — อนุมัติชั้นที่ 1
  DEPUTY:      'deputy',      // 4. ปลัดเทศบาล — อนุมัติชั้นที่ 2
  MAYOR:       'mayor',       // 5. นายกเทศมนตรี — อนุมัติชั้นที่ 3
  DRIVER:      'driver',      // 6. พนักงานขับรถ — บันทึกการเดินทาง + ยื่นคำขอได้
  REQUESTER:   'requester',   // 7. ผู้ขอใช้รถ — ยื่นคำขอเฉพาะกองตัวเอง
  // legacy aliases — โค้ดเดิม (isAdmin/isManager/isApprover/isUser) ยังทำงานได้ถูกความหมาย
  ADMIN:    'super_admin',
  MANAGER:  'div_admin',
  APPROVER: 'director',
  USER:     'requester'
};

const ROLE_LABELS = {
  super_admin: 'ซุปเปอร์แอดมิน',
  div_admin:   'แอดมินระดับกอง',
  director:    'ผู้อำนวยการกอง',
  deputy:      'ปลัดเทศบาล',
  mayor:       'นายกเทศมนตรี',
  driver:      'พนักงานขับรถ',
  requester:   'ผู้ขอใช้รถ'
};

// ---------- สถานะคำขอ (3-level approval — ผู้ขอเลือกรถ/คนขับเองตอนยื่นคำขอ) ----------
const REQUEST_STATUS = {
  PENDING:     'pending',      // รออนุมัติชั้น 1 (ผอ.กอง)
  APPROVED_L1: 'approved_l1',  // ผอ.กองอนุมัติแล้ว รออนุมัติชั้น 2 (ปลัด)
  APPROVED_L2: 'approved_l2',  // ปลัดอนุมัติแล้ว รออนุมัติชั้น 3 (นายก)
  APPROVED:    'approved',     // นายกอนุมัติแล้ว พร้อมเดินทาง
  IN_PROGRESS: 'in_progress',  // กำลังเดินทาง
  COMPLETED:   'completed',    // เสร็จสิ้น
  REJECTED:    'rejected',     // ถูกปฏิเสธ
  CANCELLED:   'cancelled'     // ผู้ขอยกเลิก
};

const STATUS_LABELS = {
  pending:     { text: 'รออนุมัติชั้น 1 (ผอ.กอง)', color: '#f59e0b', bg: '#fef3c7' },
  approved_l1: { text: 'รออนุมัติชั้น 2 (ปลัด)',   color: '#f97316', bg: '#ffedd5' },
  approved_l2: { text: 'รออนุมัติชั้น 3 (นายก)',   color: '#6366f1', bg: '#e0e7ff' },
  approved:    { text: 'อนุมัติแล้ว พร้อมเดินทาง', color: '#10b981', bg: '#d1fae5' },
  in_progress: { text: 'กำลังเดินทาง',             color: '#8b5cf6', bg: '#ede9fe' },
  completed:   { text: 'เสร็จสิ้น',                color: '#64748b', bg: '#f1f5f9' },
  rejected:    { text: 'ไม่อนุมัติ',               color: '#ef4444', bg: '#fee2e2' },
  cancelled:   { text: 'ยกเลิก',                   color: '#6b7280', bg: '#f3f4f6' }
};

// ---------- สถานะรถ ----------
const VEHICLE_STATUS = {
  AVAILABLE:   'available',   // พร้อมใช้งาน
  IN_USE:      'in_use',      // กำลังใช้งาน
  MAINTENANCE: 'maintenance', // ซ่อมบำรุง
  RETIRED:     'retired'      // ปลดระวาง
};

const VEHICLE_STATUS_LABELS = {
  available:   'พร้อมใช้งาน',
  in_use:      'กำลังใช้งาน',
  maintenance: 'ซ่อมบำรุง',
  retired:     'ปลดระวาง'
};

// ---------- ประเภทรถ ----------
const VEHICLE_TYPES = {
  sedan:    'รถเก๋ง',
  pickup:   'รถกระบะ',
  van:      'รถตู้',
  bus:      'รถบัส/รถโดยสาร',
  suv:      'SUV',
  truck:    'รถบรรทุก',
  other:    'อื่นๆ'
};

// ---------- Session ----------
const SESSION = {
  TTL_SECONDS: 8 * 60 * 60,  // 8 ชั่วโมง
  CACHE_PREFIX: 'sess_'
};

// ---------- ACTIONS สำหรับ approval log ----------
const APPROVAL_ACTIONS = {
  SUBMIT:   'submit',
  APPROVE:  'approve',
  REJECT:   'reject',
  ASSIGN:   'assign',    // จัดสรรรถ/คนขับ
  CANCEL:   'cancel',
  START:    'start',     // เริ่มเดินทาง
  COMPLETE: 'complete'   // จบเดินทาง
};
