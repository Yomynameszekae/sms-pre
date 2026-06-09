# School Management System — Technical Architecture

Below is a practical technical architecture you can realistically build as a solo backend-focused developer, using Node.js/TypeScript and a JavaScript frontend.

The PRD describes a web-based School Management System for a Ghanaian private basic school running both GES/NaCCA and ABEKA curricula, covering admissions, student records, classes, attendance, grading, report cards, fees, MoMo payments, SMS communication, parent portal, staff records, compliance, audit logs, and backups. It also clearly recommends keeping the MVP strict, with WhatsApp, USSD, mobile apps, full parallel dual-gradebooks, payroll, inventory, and advanced analytics deferred to V2.

---

# Recommended Architecture

## 1. High-Level System Design

Use a **modular monolith** for the MVP.

Do not start with microservices. This system has many modules, but they are tightly connected: students, classes, attendance, grades, invoices, payments, guardians, report cards, and notifications all share the same data. A modular monolith will be much easier for you to build alone, test, deploy, and maintain.

Recommended structure:

```txt
Frontend Web App
  ↓
REST API / Backend
  ↓
Application Modules
  - Auth & Users
  - School Setup
  - Students & Guardians
  - Classes & Enrollment
  - Curriculum & Subjects
  - Attendance
  - Assessment & Grading
  - Report Cards
  - Fees & Billing
  - Payments
  - SMS & Notifications
  - Staff Records
  - Reports
  - Audit Logs
  - Settings
  ↓
Database
  ↓
Object Storage
  ↓
External Services
  - Paystack or Hubtel
  - Arkesel / mNotify / Hubtel SMS
```

---

# 2. Tech Stack Recommendation

## Backend

Use:

```txt
Node.js + TypeScript + NestJS
```

NestJS is a good fit because it is built around modules, controllers, services, guards, interceptors, and dependency injection. That structure maps very well to a large school system with many modules. NestJS officially supports TypeScript and is designed for scalable Node.js server-side applications.

Backend stack:

```txt
Runtime: Node.js
Framework: NestJS
Language: TypeScript
API Style: REST first
Validation: class-validator + class-transformer or Zod
ORM: Prisma
Database: PostgreSQL
Auth: JWT access token + refresh token
Background Jobs: BullMQ + Redis
PDF Generation: Puppeteer or Playwright
File Uploads: Multer + S3-compatible storage
Testing: Jest
API Docs: Swagger/OpenAPI
```

Use **REST**, not GraphQL, for MVP. REST will be easier for admin screens, mobile browser parent portal, payments, webhooks, and reports.

## Database

Use:

```txt
PostgreSQL
```

Even though you usually use MySQL, I recommend PostgreSQL for this project because the PRD contains several fields that naturally fit JSON storage: consent details, computed grades, attendance summaries, notification audiences, gateway payloads, audit diffs, and report card computed results. The PRD itself references JSONB-style fields in many places.

PostgreSQL gives you strong relational modelling plus good JSONB support. MySQL can still work, but PostgreSQL is better for this system.

Use Prisma because it gives you type-safe database access for Node.js/TypeScript and supports both PostgreSQL and MySQL, so you still have flexibility if you later decide to switch.

## Frontend

Use:

```txt
Next.js + React + TypeScript
```

Since you want JavaScript for the frontend but are unsure of the framework, I recommend **Next.js**.

Reasons:

Next.js gives you React with routing, layouts, server-side rendering options, API integration patterns, and good support for mobile-friendly web apps. The PRD defers native mobile apps and recommends a parent web portal/PWA-style direction, so Next.js fits well. Next.js officially describes itself as a React framework for building web applications, and its App Router provides file-system routing with modern React features.

Frontend stack:

```txt
Framework: Next.js
Language: TypeScript
UI: Tailwind CSS + shadcn/ui
Forms: React Hook Form + Zod
Tables: TanStack Table
Charts: Recharts
State/Data Fetching: TanStack Query
Auth Handling: HTTP-only cookies
PDF Viewing: Browser PDF viewer or embedded viewer
```

Although you said JavaScript, I would still use **TypeScript on the frontend** because your backend will be TypeScript. It will reduce mistakes across DTOs, forms, and API responses.

---

# 3. Database Schema

Below is a practical MVP schema. I am grouping it by module.

## Core School Setup

```txt
schools
- id
- name
- logo_url
- address
- ghana_post_gps
- phone
- email
- motto
- registration_number
- created_at
- updated_at

academic_years
- id
- school_id
- label
- start_date
- end_date
- is_active
- created_at

terms
- id
- academic_year_id
- term_number
- label
- start_date
- end_date
- exam_start_date
- exam_end_date
- status -- draft, active, closed
- curriculum_track -- GES_NACCA, ABEKA, BOTH
- created_at

levels
- id
- school_id
- name -- KG1, Basic 4
- ges_designation
- abeka_designation
- order_index
- level_group -- ECE, LOWER_PRIMARY, UPPER_PRIMARY, JHS
- is_active

classrooms
- id
- level_id
- academic_year_id
- section_label -- A, B
- capacity
- class_teacher_id
- is_active
```

## Users, Roles, and Staff

```txt
users
- id
- email
- phone
- password_hash
- linked_entity_type -- staff, guardian
- linked_entity_id
- is_active
- must_change_password
- last_login_at
- created_at
- updated_at

roles
- id
- name
- description

permissions
- id
- key
- description

role_permissions
- id
- role_id
- permission_id

user_roles
- id
- user_id
- role_id
- granted_by
- granted_at

staff
- id
- first_name
- last_name
- phone
- email
- staff_number
- role_category -- teacher, admin, support
- ntc_registration_number
- ntc_status
- police_clearance_date
- police_clearance_expiry
- medical_cert_date
- medical_cert_expiry
- employment_type
- status
- created_at
```

The PRD includes roles such as Super Admin, School Administrator, Headteacher, Academic Coordinator, Class Teacher, Subject Teacher, Bursar, Admissions, Parent/Guardian, Compliance Officer, and optional Student.

## Students and Guardians

```txt
students
- id
- student_number
- first_name
- middle_name
- last_name
- preferred_name
- date_of_birth
- gender
- nationality
- religion
- ghana_card_id
- profile_photo_url
- previous_school
- medical_alerts_encrypted
- admission_date
- status -- active, transferred, graduated, withdrawn
- created_at
- updated_at

guardians
- id
- first_name
- last_name
- relationship
- phone_primary
- phone_secondary
- email
- occupation
- created_at

student_guardians
- id
- student_id
- guardian_id
- is_primary
- is_emergency_contact

admission_applications
- id
- student_id
- enquiry_source
- intended_level_id
- curriculum_interest
- status -- enquiry, application, offered, rejected, enrolled
- notes
- created_at

consent_records
- id
- student_id
- guardian_id
- consent_type -- educational_processing, marketing
- granted
- granted_at
- ip_address
- method -- checkbox, otp, signature
- revoked_at
```

The PRD recommends keeping Ghana Card optional in MVP until the exact school/GES requirement is confirmed.

## Enrollment and Class Placement

```txt
enrollments
- id
- student_id
- classroom_id
- academic_year_id
- curriculum_track -- GES_NACCA, ABEKA
- enrollment_date
- status -- active, transferred, withdrawn, completed
- exit_date
- exit_reason

promotion_records
- id
- student_id
- from_classroom_id
- to_classroom_id
- academic_year_id
- decision -- promoted, retained, graduated, withdrawn
- approved_by
- created_at
```

For MVP, I would follow the PRD recommendation: one primary curriculum track per student. Do not build full parallel gradebooks yet unless the school confirms it as day-one critical.

## Curriculum, Subjects, and Teacher Assignments

```txt
curriculum_tracks
- id
- school_id
- code -- GES_NACCA, ABEKA
- name
- is_active

subjects
- id
- school_id
- name
- code
- curriculum_track_id
- level_group_applicability -- jsonb
- credit_hours
- is_active

class_subjects
- id
- classroom_id
- subject_id
- term_id
- is_active

subject_assignments
- id
- staff_id
- subject_id
- classroom_id
- term_id
```

## Attendance

```txt
attendance_sessions
- id
- classroom_id
- term_id
- attendance_date
- recorded_by
- status -- draft, submitted, locked
- created_at

attendance_records
- id
- attendance_session_id
- enrollment_id
- status -- present, absent, late, excused
- notes

attendance_locks
- id
- term_id
- lock_after_days
- configured_by
```

Attendance should default all students to Present, then allow the teacher to mark Absent, Late, or Excused, as described in the PRD workflow.

## Assessment and Grading

```txt
assessment_types
- id
- school_id
- name
- curriculum_track_id
- level_group
- max_score
- weight_percentage
- assessment_category -- formative, summative, exam
- is_active

assessment_scores
- id
- enrollment_id
- subject_id
- assessment_type_id
- term_id
- raw_score
- max_score
- recorded_by
- recorded_at
- is_locked

grading_scales
- id
- school_id
- curriculum_track_id
- level_group
- min_score
- max_score
- letter_grade
- descriptor
- gpa_value
- is_active

grade_formula_configs
- id
- school_id
- curriculum_track_id
- level_group
- subject_id nullable
- config_json
- is_active
```

Keep grading formula-driven, not hardcoded. The PRD warns that SBA/exam weights and ABEKA GPA scales must be verified and configurable.

## Report Cards

```txt
report_card_templates
- id
- school_id
- name
- curriculum_track_id
- level_group
- template_type -- GES_PRIMARY, GES_JHS, ABEKA, ECE
- config_json
- is_active

report_cards
- id
- enrollment_id
- term_id
- curriculum_track_id
- computed_grades -- jsonb
- overall_grade
- gpa
- attendance_summary -- jsonb
- teacher_remarks
- headteacher_remarks
- conduct_rating
- status -- draft, review, approved, published
- approved_by
- approved_at
- published_at

report_card_files
- id
- report_card_id
- file_url
- generated_at
```

Use JSONB for computed report data so that old report cards do not change if grading settings later change.

## Fees, Invoices, and Payments

```txt
fee_items
- id
- school_id
- name
- category
- is_active

fee_schedules
- id
- fee_item_id
- level_id
- term_id
- amount_pesewas
- is_active

invoices
- id
- student_id
- term_id
- invoice_number
- generated_at
- total_amount_pesewas
- total_paid_pesewas
- outstanding_pesewas
- arrears_pesewas
- discount_pesewas
- discount_reason
- status -- unpaid, partial, paid, waived, void
- void_reason

invoice_line_items
- id
- invoice_id
- fee_item_id
- description
- amount_pesewas

payments
- id
- invoice_id
- student_id
- amount_pesewas
- payment_method -- cash, bank_deposit, cheque, mobile_money
- payment_reference
- gateway_reference
- paid_at
- recorded_by
- receipt_number
- is_verified
- notes

payment_gateway_logs
- id
- gateway
- gateway_reference
- event_type
- payload -- jsonb
- received_at
- signature_valid
- processed
- invoice_id
```

Store all money in **pesewas**, not decimal GHS. The PRD explicitly recommends this to avoid floating-point errors.

## Notifications and SMS

```txt
message_templates
- id
- school_id
- type -- announcement, fee_reminder, report_ready, absence_alert
- title
- body
- is_active

notifications
- id
- school_id
- sender_id
- type
- subject
- body
- audience -- jsonb
- channel -- sms, portal
- sent_at
- recipient_count
- failure_count

notification_recipients
- id
- notification_id
- guardian_id
- phone
- status -- pending, sent, failed
- provider_message_id
- failure_reason
- sent_at
```

The PRD makes SMS the MVP communication channel and defers WhatsApp and USSD to V2.

## Audit and Compliance

```txt
audit_logs
- id
- user_id
- action
- entity_type
- entity_id
- changes -- jsonb
- ip_address
- user_agent
- timestamp

data_subject_requests
- id
- guardian_id
- student_id
- request_type -- access, correction, erasure
- status
- requested_at
- resolved_at
- notes

breach_incidents
- id
- severity
- description
- affected_records_estimate
- mitigation_steps
- reported_to_dpc_at
- created_by
- created_at
```

The PRD requires immutable audit logs covering login events, data changes, deletions, exports, and payment events, and it states that even Super Admin should not be able to edit or delete audit logs.

---

# 4. API Modules

Use NestJS modules like this:

```txt
src/
  modules/
    auth/
    users/
    roles/
    school-settings/
    academic-years/
    levels/
    classrooms/
    students/
    guardians/
    enrollments/
    curriculum/
    subjects/
    attendance/
    assessments/
    grading/
    report-cards/
    fees/
    invoices/
    payments/
    notifications/
    sms/
    staff/
    reports/
    audit-logs/
    files/
    webhooks/
```

## Example API Groups

```txt
Auth
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/change-password

Users & Roles
GET    /users
POST   /users
PATCH  /users/:id
POST   /users/:id/roles
GET    /roles
POST   /roles
GET    /permissions

Students
GET    /students
POST   /students
GET    /students/:id
PATCH  /students/:id
POST   /students/:id/archive
GET    /students/:id/guardians
POST   /students/:id/guardians

Admissions
POST   /admissions/enquiries
GET    /admissions/applications
POST   /admissions/applications
PATCH  /admissions/applications/:id/status

Classes
GET    /levels
POST   /levels
GET    /classrooms
POST   /classrooms
POST   /classrooms/:id/enroll-student
GET    /classrooms/:id/students

Attendance
GET    /attendance/classrooms/:classroomId
POST   /attendance/sessions
PATCH  /attendance/sessions/:id
POST   /attendance/sessions/:id/submit
GET    /attendance/reports/classroom

Assessments
GET    /assessment-types
POST   /assessment-types
GET    /gradebook
POST   /assessment-scores/bulk
POST   /assessment-scores/:id/lock

Report Cards
POST   /report-cards/generate
GET    /report-cards
GET    /report-cards/:id
POST   /report-cards/:id/approve
POST   /report-cards/:id/publish
GET    /report-cards/:id/pdf

Fees & Billing
GET    /fee-items
POST   /fee-items
GET    /fee-schedules
POST   /fee-schedules
POST   /invoices/generate-term
GET    /invoices
GET    /invoices/:id
POST   /payments/manual
GET    /payments
GET    /reports/debtors

Payments
POST   /payments/mobile-money/initiate
POST   /webhooks/paystack
POST   /webhooks/hubtel
GET    /payments/:id/receipt

SMS
POST   /notifications/send
GET    /notifications
GET    /notifications/:id
POST   /notifications/fee-reminder
POST   /notifications/absence-alert

Parent Portal
GET    /parent/me/children
GET    /parent/children/:studentId/attendance
GET    /parent/children/:studentId/grades
GET    /parent/children/:studentId/report-cards
GET    /parent/children/:studentId/invoices
```

---

# 5. Authentication Model

Use:

```txt
Email/phone + password
JWT access token
Refresh token in HTTP-only cookie
Optional 2FA for Admin and Bursar
SMS OTP for password reset
```

## Recommended Flow

For staff:

```txt
1. Admin creates user account.
2. System sends temporary password or setup link.
3. User logs in.
4. User is forced to change password.
5. Access token is issued.
6. Refresh token is stored in HTTP-only secure cookie.
```

For parents:

```txt
1. Guardian record is created during admission.
2. Parent portal account is created using phone number.
3. Parent receives SMS setup link or OTP.
4. Parent sets password.
5. Parent can only access linked children.
```

## Token Design

```txt
Access token lifespan: 15 minutes
Refresh token lifespan: 7–14 days
Refresh token storage: database hash
Cookie: HTTP-only, Secure, SameSite=Lax or Strict
```

Do not store JWTs in localStorage.

---

# 6. Role-Based Permissions

Use RBAC with permission keys.

Do not hardcode role checks like:

```ts
if (user.role === 'BURSAR')
```

Instead, check permissions:

```ts
@RequirePermission('invoices.create')
```

## Suggested Permission Groups

```txt
students.create
students.read
students.update
students.archive

guardians.create
guardians.read
guardians.update

classes.manage
enrollments.manage
promotion.manage

attendance.create
attendance.update
attendance.lock
attendance.reports.read

scores.enter
scores.update
scores.lock
grading.configure

report_cards.generate
report_cards.review
report_cards.approve
report_cards.publish
report_cards.read

fees.configure
invoices.create
invoices.read
payments.record
payments.verify
finance.reports.read

notifications.send
notifications.read

staff.manage
staff.read

settings.manage
users.manage
roles.manage

audit_logs.read
compliance.reports.read
```

## Role Mapping

```txt
Super Admin
- all permissions
- system configuration
- backups
- users and roles

School Administrator
- almost all school operations
- no audit log modification
- no direct database-level actions

Headteacher / Principal
- academic reports
- report card approval
- attendance and grade visibility
- no payment deletion

Academic Coordinator
- curriculum
- subjects
- grading configuration
- report templates
- class/teacher assignments

Class Teacher
- own class attendance
- own class remarks
- own class report card drafts
- limited student data

Subject Teacher
- assigned subject score entry
- assigned class roster
- limited student personal data

Bursar / Accountant
- invoices
- payments
- receipts
- debtor reports
- no academic score editing

Admissions / Reception
- enquiries
- student applications
- guardian records
- no financial totals
- no grades

Parent / Guardian
- read-only access to own children
- attendance, fees, report cards, notices

Compliance Officer
- read-only compliance reports
- audit trail visibility
```

---

# 7. File Storage Design

Use object storage, not database blobs.

Recommended:

```txt
Development: Local MinIO
Production: S3-compatible storage
```

MinIO is S3-compatible object storage, which makes it useful for local development and easy migration to cloud object storage later.

## Store These Files

```txt
Student photos
Staff photos
School logo
Report card PDFs
Receipt PDFs
Uploaded consent forms
Police clearance documents
Medical certificates
Possible import CSV files
```

## File Table

```txt
files
- id
- owner_type -- student, staff, report_card, payment, school
- owner_id
- file_name
- mime_type
- size_bytes
- storage_key
- public_url nullable
- uploaded_by
- created_at
```

## Storage Rules

Use private buckets by default.

```txt
/school/{schoolId}/students/{studentId}/profile.jpg
/school/{schoolId}/report-cards/{termId}/{studentId}.pdf
/school/{schoolId}/receipts/{paymentId}.pdf
/school/{schoolId}/staff/{staffId}/police-clearance.pdf
```

Serve files through signed URLs:

```txt
GET /files/:id/signed-url
```

Do not expose raw bucket paths to users.

---

# 8. Payment Integration Design

The PRD recommends one payment gateway in MVP, Paystack or Hubtel, with webhook verification, idempotency, server-side verification, and payment logs.

For you, I would start with:

```txt
Paystack first
Hubtel second if the school prefers it
```

Paystack is usually easier for developers. Hubtel may be attractive locally in Ghana depending on the school’s bank and settlement preference.

## Payment Flow

```txt
1. Bursar opens invoice.
2. Bursar clicks “Send MoMo Payment Link”.
3. Backend creates payment initiation record.
4. Backend calls payment gateway initialize endpoint.
5. Gateway returns payment URL.
6. SMS is sent to guardian with payment link.
7. Parent pays.
8. Gateway sends webhook.
9. Backend verifies webhook signature.
10. Backend checks idempotency.
11. Backend calls gateway verify endpoint.
12. Backend records payment.
13. Backend updates invoice balance.
14. Backend generates receipt.
15. Backend sends SMS receipt.
```

## Payment Tables

```txt
payment_intents
- id
- invoice_id
- student_id
- gateway
- amount_pesewas
- status -- pending, successful, failed, expired
- gateway_reference
- authorization_url
- expires_at
- created_by
- created_at

payments
- id
- invoice_id
- student_id
- amount_pesewas
- payment_method
- gateway_reference
- paid_at
- receipt_number
- is_verified

payment_gateway_logs
- id
- gateway
- event_type
- gateway_reference
- payload
- signature_valid
- processed
- received_at
```

## Important Rules

Never update an invoice from the frontend redirect.

Only update payment status after:

```txt
Webhook signature is valid
Gateway reference has not already been processed
Server-side verification confirms success
Amount matches expected amount
Currency is GHS
Invoice is still open
```

---

# 9. SMS Integration Design

Use a provider abstraction so you can switch between Arkesel, mNotify, or Hubtel SMS.

```txt
SmsProvider interface
- sendSingle(to, message)
- sendBulk(recipients, message)
- getBalance()
```

Implementation:

```txt
ArkeselSmsProvider
MnotifySmsProvider
HubtelSmsProvider
```

## SMS Flow

```txt
1. User selects audience.
2. System resolves guardians.
3. System validates phone numbers.
4. Message is created.
5. Recipients are inserted as pending.
6. Job is pushed to queue.
7. Worker sends SMS.
8. Provider response is saved.
9. Failed messages are marked for retry or follow-up.
```

## Why Use a Queue?

Do not send bulk SMS inside the request-response cycle. Use BullMQ + Redis.

```txt
POST /notifications/send
→ create notification
→ queue SMS jobs
→ return response quickly
→ worker processes SMS
```

## SMS Events

```txt
announcement
fee_reminder
report_ready
absence_alert
payment_receipt
account_setup
password_reset
```

---

# 10. Offline-Tolerant Design

The PRD mentions that attendance and grades should work under poor connections.

For MVP, do not overbuild full offline sync. Instead:

```txt
Frontend saves draft attendance/score entries locally.
User can retry submission when internet returns.
Backend supports bulk save.
UI clearly shows unsynced changes.
```

Use:

```txt
IndexedDB or localStorage for temporary draft data
TanStack Query retry
Bulk endpoints
```

Later, if needed, convert the parent/teacher frontend into a stronger PWA.

---

# 11. Deployment Approach

## MVP Deployment

Use Docker Compose on a VPS or cloud VM.

```txt
Nginx
Frontend: Next.js
Backend: NestJS
Database: PostgreSQL
Redis: job queue
Object Storage: MinIO or managed S3
Worker: NestJS queue worker
```

## Suggested Infrastructure

For solo development:

```txt
Option A: Render / Railway / Fly.io for simplicity
Option B: DigitalOcean / Hetzner / AWS Lightsail VPS with Docker
Option C: AWS ECS/RDS/S3 when budget allows
```

The PRD itself mentions React/Next.js for the frontend and recommends a reputable cloud provider while noting that hosting and data localisation should be reviewed carefully because of Ghanaian data protection requirements.

## Practical Production Setup

```txt
Frontend:
- Next.js deployed as container

Backend:
- NestJS API container

Worker:
- NestJS worker container for SMS, PDFs, backups, payment reconciliation

Database:
- Managed PostgreSQL if possible
- If self-hosted, automated backups are mandatory

Storage:
- S3-compatible bucket
- Private access only

Reverse Proxy:
- Nginx or Caddy
- HTTPS enabled

Monitoring:
- Sentry for errors
- UptimeRobot or Better Stack for uptime
- Structured logs
```

## Environments

```txt
local
staging
production
```

Never test payment webhooks directly only on production. Use staging first.

---

# 12. Security Controls

## API Security

```txt
JWT authentication
Refresh token rotation
Password hashing with Argon2 or bcrypt
Rate limiting on login and OTP endpoints
Input validation on every DTO
Permission guards at API level
Audit logging for sensitive actions
CORS restricted to known frontend domains
Helmet security headers
Request size limits
```

## Data Security

```txt
TLS everywhere
Encrypt sensitive fields such as medical alerts
Private object storage buckets
Signed URLs for files
Database backups encrypted
Secrets stored in environment variables or secret manager
No payment card data stored
```

## Access Control

Enforce access in the backend, not just the UI.

Examples:

```txt
Parent can only access students linked through student_guardians.
Class teacher can only access assigned classroom.
Subject teacher can only enter scores for assigned subject/class.
Bursar can access invoices but not edit grades.
Compliance officer is read-only.
```

## Audit Logging

Log:

```txt
Login attempts
Password changes
Student record creation/update/archive
Guardian changes
Attendance updates
Score changes
Report card approval/publishing
Invoice creation
Payment recording
Webhook processing
File downloads
Data exports
Role changes
```

## Compliance Notes

The PRD states that the school should comply with Ghana’s Data Protection Act, record consent, protect children’s data, enforce role-based access at API level, keep audit logs, support data requests, and prepare breach response workflows. It also warns that legal verification is needed and that the school should register with the Data Protection Commission as a Data Controller.

---

# 13. Recommended Build Order

Because you want to take this on alone, build in this order:

## Phase 1: Foundation

```txt
NestJS project
Next.js project
PostgreSQL + Prisma
Auth
Roles and permissions
School settings
Academic year/term
Levels/classes
Staff records
```

## Phase 2: Students

```txt
Admissions
Students
Guardians
Consent logging
Class enrollment
Parent account creation
```

## Phase 3: Academics

```txt
Curriculum tracks
Subjects
Class subjects
Teacher assignments
Attendance
Assessment types
Score entry
Grading engine
```

## Phase 4: Report Cards

```txt
Report card templates
Grade computation snapshot
Teacher remarks
Headteacher approval
PDF generation
Parent viewing
```

## Phase 5: Finance

```txt
Fee items
Fee schedules
Invoice generation
Manual payments
Receipts
Debtor report
```

## Phase 6: Integrations

```txt
SMS provider
Payment gateway
Payment webhook
SMS receipts
Fee reminders
Report card notifications
```

## Phase 7: Compliance and Reports

```txt
Audit logs
Basic admin reports
NaSIA-ready exports
Backup automation
Data request logs
```

This is close to the PRD’s MVP build sequence, which estimates around 27–35 weeks for a small team if scope is controlled. Since you are building alone, I would plan closer to **9–12 months**, unless you reduce the first release further.

---

# 14. My Strong Recommendation for You

Use this stack:

```txt
Frontend: Next.js + TypeScript + Tailwind + shadcn/ui
Backend: NestJS + TypeScript
Database: PostgreSQL
ORM: Prisma
Queue: Redis + BullMQ
Storage: S3-compatible storage, MinIO locally
Payments: Paystack first, Hubtel optional later
SMS: Arkesel first, with provider abstraction
PDF: Puppeteer/Playwright
Deployment: Docker Compose first, then managed services later
```

This gives you a professional architecture without making the project too heavy.

The most important technical decision is to **keep the MVP modular but not distributed**. Build one backend, one frontend, one database, one queue worker, and clean module boundaries. That is enough for a serious school management system and still realistic for one developer.
