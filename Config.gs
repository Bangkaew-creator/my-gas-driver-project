/**
 * ============================================================================
 *  Config.gs
 *  ค่าคงที่ของระบบทั้งหมด — แก้ไขที่นี่จุดเดียว
 * ============================================================================
 */

// ---------- ข้อมูลระบบ (แก้ตรงนี้ก่อน deploy) ----------
const SPREADSHEET_ID = '1jOC5stCTrsLFWSVSXhPsXexLAnQmS8g9xvTtAKlaCWE';
const ADMIN_EMAIL    = 'wirathadkam@gmail.com';
const ORG_NAME       = 'สำนักงานเดฟไทบ้าน2026';
const SYSTEM_NAME    = 'ระบบขอใช้รถราชการ';

// ---------- ชื่อชีตในฐานข้อมูล ----------
const SHEETS = {
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

// ---------- โครงสร้างคอลัมน์ (schema) ----------
const SCHEMA = {
  [SHEETS.USERS]: [
    'id','username','password_hash','salt','fullname','email',
    'department','position','phone','role','status','created_at','updated_at'
  ],
  [SHEETS.VEHICLES]: [
    'id','plate_number','brand','model','year','type','seats','color',
    'fuel_type','current_mileage','status','notes','created_at','updated_at'
  ],
  [SHEETS.DRIVERS]: [
    'id','employee_code','fullname','license_number','license_expiry',
    'phone','email','status','notes','created_at','updated_at'
  ],
  [SHEETS.REQUESTS]: [
    'id','request_no','requester_id','requester_name','department','position','phone',
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

// ---------- Role (บทบาท) ----------
const ROLES = {
  ADMIN:    'admin',    // ผู้ดูแลระบบ — ทุกสิทธิ์
  MANAGER:  'manager',  // ผู้จัดการรถ — จัดสรรรถ/คนขับ, อนุมัติขั้น 2
  APPROVER: 'approver', // หัวหน้าแผนก — อนุมัติขั้น 1
  USER:     'user',     // ผู้ขอใช้รถ
  DRIVER:   'driver'    // พนักงานขับรถ — บันทึก trip
};

const ROLE_LABELS = {
  admin:    'ผู้ดูแลระบบ',
  manager:  'ผู้จัดการรถ',
  approver: 'หัวหน้าแผนก (ผู้อนุมัติ)',
  user:     'ผู้ขอใช้รถ',
  driver:   'พนักงานขับรถ'
};

// ---------- สถานะคำขอ ----------
const REQUEST_STATUS = {
  PENDING:     'pending',      // รอหัวหน้าแผนกอนุมัติ
  APPROVED_L1: 'approved_l1',  // หัวหน้าอนุมัติแล้ว รอจัดสรรรถ
  APPROVED:    'approved',     // จัดสรรรถแล้ว พร้อมเดินทาง
  IN_PROGRESS: 'in_progress',  // กำลังเดินทาง
  COMPLETED:   'completed',    // เสร็จสิ้น
  REJECTED:    'rejected',     // ถูกปฏิเสธ
  CANCELLED:   'cancelled'     // ผู้ขอยกเลิก
};

const STATUS_LABELS = {
  pending:     { text: 'รออนุมัติขั้น 1',       color: '#f59e0b', bg: '#fef3c7' },
  approved_l1: { text: 'รอจัดสรรรถ',           color: '#3b82f6', bg: '#dbeafe' },
  approved:    { text: 'อนุมัติแล้ว',           color: '#10b981', bg: '#d1fae5' },
  in_progress: { text: 'กำลังเดินทาง',         color: '#8b5cf6', bg: '#ede9fe' },
  completed:   { text: 'เสร็จสิ้น',             color: '#64748b', bg: '#f1f5f9' },
  rejected:    { text: 'ไม่อนุมัติ',            color: '#ef4444', bg: '#fee2e2' },
  cancelled:   { text: 'ยกเลิก',                color: '#6b7280', bg: '#f3f4f6' }
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
