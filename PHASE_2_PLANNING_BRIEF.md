# Phase 2 Planning Brief
### Ghana School Management System (Brite SMS)

**Status:** Phase 1 complete — this brief outlines what comes next  
**Date:** June 2026  
**Audience:** Project stakeholders, development team, school leadership  

---

## Overview

Phase 1 delivered the data foundation: authentication, school structure, people records, admissions, and the enrollment pipeline. Phase 1 is backend-only (API), with no frontend and no transactional features.

Phase 2 builds on that foundation. It adds the day-to-day operational features schools need to run — attendance, assessments, fees, communications, and a parent-facing portal — along with the web interface that makes all of it accessible without technical tools.

---

## Phase 2 Goals

1. **Frontend web application** — A browser-based interface for school staff and administrators so that Postman is no longer required for any task.
2. **Academic operations** — Attendance tracking, assessments, grading, and report cards.
3. **Finance** — Fee schedules, invoices, receipts, and payment tracking.
4. **Communications** — SMS notifications to parents and guardians, in-app notifications for staff.
5. **Parent portal** — A limited login view for guardians to see their child's attendance, results, and invoices.
6. **File storage** — Actual binary file upload (documents, images) backed by S3 or equivalent.
7. **System resilience** — Backup scheduling, security incident logging, data subject request handling.

---

## Phase 2 Feature Modules

### 2.1 Frontend Web Application (Next.js)

The entire Phase 1 API already exists and is ready to be consumed. The frontend will provide:

- Login screen and session management
- Dashboard for each role (Admin, Headteacher, Class Teacher, Admissions Officer, etc.)
- Forms and tables for all Phase 1 modules (replacing Postman for day-to-day use)
- Responsive design for desktop and tablet

**Dependency:** Requires Phase 1 API to be deployed and stable. All Phase 1 modules are covered.

---

### 2.2 Attendance Tracking

Track daily attendance for each student in each classroom, per term.

**Key features:**
- Mark attendance per student per day: present, absent, excused, late
- Bulk attendance entry (mark whole class at once)
- Attendance summary per student (days present, absent, percentage)
- Attendance report per classroom and per term
- Export attendance data

**Data dependencies:** Students, classrooms, enrollments, terms

**Roles that need access:** Class Teacher, Academic Coordinator, Headteacher

---

### 2.3 Assessments and Grading

Record scores for class tests, mid-terms, end-of-term exams, and continuous assessment.

**Key features:**
- Create assessment types (class test, mid-term, exam, project, etc.)
- Record scores per student per assessment
- Weight different assessment types (e.g. 30% continuous assessment, 70% end-of-term)
- Calculate final grades based on configured grading scale
- Grading scales configurable per school (GES scale, letter grades, percentage, etc.)

**Data dependencies:** Students, classrooms, enrollments, terms, levels

**Roles that need access:** Class Teacher (record scores), Academic Coordinator (view/approve), Headteacher (view)

---

### 2.4 Report Cards

Generate end-of-term or end-of-year academic reports for each student.

**Key features:**
- Auto-calculate results from assessment records
- Include attendance summary
- Add class teacher remarks and headteacher remarks
- Generate PDF report cards
- Optionally share with guardians via portal or SMS link

**Data dependencies:** Assessments, attendance, students, classrooms, terms, levels

**Roles that need access:** Class Teacher (remarks), Academic Coordinator (review), Headteacher (approve/publish)

---

### 2.5 Fee Management — Schedules and Invoices

Define school fees and generate invoices for each student per term.

**Key features:**
- Create fee schedules (tuition, PTA, feeding, uniform, etc.) per level and per term
- Auto-generate invoices when a student is enrolled or a term opens
- Manual invoice creation for ad hoc charges
- Invoice line items, discounts, and adjustments
- Invoice status: pending, partially paid, paid, cancelled

**Data dependencies:** Students, enrollments, academic years, terms, levels

**Roles that need access:** School Admin, Bursar (new role), Admissions Officer (view)

---

### 2.6 Payment Collection and Receipts

Record payments against invoices and issue receipts.

**Key features:**
- Record payments: cash, mobile money, bank transfer, cheque
- Partial payment support
- Auto-generate receipt on payment
- Overdue invoice flagging
- Fee balance reports per student and per class
- Integration with mobile money providers (MTN MoMo, Vodafone Cash, AirtelTigo Money) — optional, depends on provider APIs

**Data dependencies:** Invoices, students, guardians

**Roles that need access:** Bursar, School Admin, Headteacher (view)

---

### 2.7 SMS Notifications

Send automated or manual SMS messages to parents and guardians.

**Key features:**
- Automated triggers: invoice generated, payment received, term opening/closing, attendance alerts
- Manual bulk SMS to all guardians or a classroom's guardians
- SMS delivery status tracking (sent, delivered, failed)
- SMS provider integration (e.g. Hubtel, Arkesel, or equivalent Ghanaian provider)
- Character count and cost preview before sending
- Opt-out management

**Data dependencies:** Guardians, student-guardian links, students, invoices, attendance

**Roles that need access:** School Admin, Headteacher

---

### 2.8 Parent / Guardian Portal

A limited web login for parents and guardians to view their child's school information.

**Key features:**
- Guardian login (email or phone + OTP or password)
- View linked children's profiles
- View current enrollment and classroom
- View attendance record for the current term
- View assessment results and report cards (when published)
- View and download invoices and receipts
- Receive in-portal notifications

**Data dependencies:** Guardians, student-guardian links, students, attendance, assessments, invoices, report cards

**Security note:** Guardian access must be strictly scoped to their own linked students. This is already enforced at the permission level in Phase 1 (`PARENT_GUARDIAN` role — linked only).

---

### 2.9 Binary File Upload (S3 / Cloud Storage)

Phase 1 stores file metadata only. Phase 2 completes this with actual file upload and retrieval.

**Key features:**
- Secure file upload to S3-compatible storage (AWS S3, MinIO, Cloudflare R2, etc.)
- Pre-signed URL generation for temporary secure download access
- File type and size validation on upload
- Virus scan integration (optional, depends on provider)
- Files remain private by default — URLs expire and are not public

**Data dependencies:** Files module (already complete in Phase 1)

---

### 2.10 Data Subject Requests (GDPR / Data Protection)

Comply with Ghana's Data Protection Act 2012 and international best practice.

**Key features:**
- Log and track data access requests from parents and students
- Export all personal data for a specific individual (right of access)
- Flag records for deletion review (right to erasure — subject to school retention policy)
- Data processing purpose tracking

**Roles that need access:** School Admin, Compliance Officer

---

### 2.11 Security Incidents

A formal log for tracking data breaches or suspicious system activity.

**Key features:**
- Record a security incident with type, severity, description, and resolution
- Link to affected user accounts or records
- Track resolution status
- Export for regulatory reporting

**Roles that need access:** School Admin, Compliance Officer

---

### 2.12 Backup Management

Scheduled and on-demand database backups for operational safety.

**Key features:**
- Configurable backup schedule (daily, weekly)
- Backup to S3-compatible storage
- Restore from backup (admin only)
- Backup verification and integrity check
- Backup history log

---

## Phase 2 New Roles

| Role | Purpose |
|---|---|
| Bursar | Finance module access — invoices, payments, receipts |
| Parent/Guardian | Portal login for viewing linked student data |

The `PARENT_GUARDIAN` role already exists in Phase 1 but with no portal to log in from. Phase 2 activates this role.

---

## Phase 2 Dependencies on Phase 1

Phase 2 depends on Phase 1 being stable and deployed. The following Phase 1 components are direct foundations for Phase 2 features:

| Phase 1 Component | Used by in Phase 2 |
|---|---|
| Students | Attendance, Assessments, Fees, Report Cards, Portal |
| Guardians + Links | SMS, Portal, Fees |
| Classrooms + Levels | Attendance, Assessments, Report Cards |
| Academic Years + Terms | Fees, Attendance, Assessments |
| Enrollments | All academic and finance features |
| Audit Logs | Security incidents, data subject requests |
| Files (Metadata) | File upload completion |
| Auth (JWT + Refresh) | Parent portal login |
| RBAC (Roles + Permissions) | All new role-based access in Phase 2 |

---

## Suggested Phase 2 Build Order

The recommended build sequence minimises blocked dependencies:

```
1. Frontend (skeleton + auth) — unblocks visual testing of Phase 1 modules
2. Attendance — depends only on Phase 1 stable modules
3. Assessments + Grading — depends on Attendance (for context) + Phase 1
4. Report Cards — depends on Assessments + Attendance
5. Fee Schedules + Invoices — depends on Enrollments, Terms, Levels
6. Payment Collection + Receipts — depends on Invoices
7. SMS Notifications — depends on Guardians, Invoices, Attendance
8. Binary File Upload — depends on Files module (Phase 1 complete)
9. Parent Portal — depends on most of the above
10. Data Subject Requests — depends on stable data model
11. Security Incidents — independent, can be done any time
12. Backup Management — infrastructure concern, can be done any time
```

---

## Open Questions for Phase 2 Planning

The following decisions should be made before Phase 2 development begins:

1. **Curriculum scope:** Will the system support IB, GES/NACCA, or both simultaneously? Assessment and grading structures differ significantly between them.
2. **Mobile money integration:** Which Ghanaian payment providers should be supported? (MTN MoMo, Vodafone Cash, AirtelTigo Money, or a payment gateway like Hubtel or Paystack?)
3. **SMS provider:** Which SMS provider serves the school's region best? (Hubtel, Arkesel, mNotify, etc.)
4. **Report card format:** Does the school use a standard GES report card template or a custom school design?
5. **File storage provider:** AWS S3, Cloudflare R2, MinIO (self-hosted), or another S3-compatible service?
6. **Guardian portal delivery:** Web only, or also a mobile app (Android/iOS)?
7. **Multi-branch support:** Is this system for a single school or will it need to support multiple campuses under one school umbrella?
8. **Data retention policy:** How long should student records, audit logs, and financial records be kept before archiving or deletion?
9. **GDPR / Data Protection Act compliance level:** Which specific obligations apply to this school? (Determines scope of data subject request module.)

---

## Phase 2 Timeline Estimate (Indicative)

These estimates assume a single full-stack developer working on Phase 2 after Phase 1 handoff. Adjust based on team size and stakeholder review cycles.

| Feature group | Estimated effort |
|---|---|
| Frontend (skeleton + Phase 1 modules) | 6–8 weeks |
| Attendance | 2–3 weeks |
| Assessments + Grading | 3–4 weeks |
| Report Cards + PDF generation | 2–3 weeks |
| Fee Schedules + Invoices | 3–4 weeks |
| Payment Collection + Receipts | 3–4 weeks |
| SMS Notifications | 2 weeks |
| Binary File Upload | 1–2 weeks |
| Parent Portal | 4–6 weeks |
| Data Subject Requests | 1–2 weeks |
| Security Incidents | 1 week |
| Backup Management | 1 week |
| **Total (rough)** | **~30–42 weeks** |

Parallel development across feature groups can reduce wall-clock time significantly.

---

*This brief is a planning reference, not a build specification. A detailed technical specification (equivalent to the Phase 1 starter docs) will be produced at the start of Phase 2.*
