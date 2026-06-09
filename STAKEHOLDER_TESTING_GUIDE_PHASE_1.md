# Stakeholder Testing Guide — Phase 1
### Ghana School Management System (Brite SMS)

**Version:** Phase 1  
**Audience:** Non-developer testers — school administrators, headteachers, admissions officers, and any stakeholder invited to validate the system before launch  
**Date:** June 2026  

---

## Table of Contents

1. [What Phase 1 Includes](#1-what-phase-1-includes)
2. [What Phase 1 Does Not Include](#2-what-phase-1-does-not-include)
3. [How to Log In](#3-how-to-log-in)
4. [Suggested Testing Order](#4-suggested-testing-order)
5. [What Each Module Is For](#5-what-each-module-is-for)
6. [Test Scenarios](#6-test-scenarios)
7. [What to Report](#7-what-to-report)
8. [Known Limitations](#8-known-limitations)
9. [How to Submit Feedback and Bug Reports](#9-how-to-submit-feedback-and-bug-reports)

---

## 1. What Phase 1 Includes

Phase 1 is the **data foundation** of the school management system. It covers all the core records a school needs to operate: school identity, academic structure, people (staff, students, guardians), and the admission-to-enrollment pipeline.

### Modules in Phase 1

| Module | What it manages |
|---|---|
| Authentication | Login, logout, password management, session security |
| School Profile | School name, address, contact details, logo path |
| School Settings | System-wide configuration values (curriculum type, numbering formats, etc.) |
| Academic Years | Annual academic cycles (e.g. 2025/2026) |
| Terms | Academic terms within a year (e.g. Term 1, Term 2, Term 3) |
| Levels | Year groups / classes (e.g. Primary 1, JHS 1, Creche) |
| Staff | Teaching and non-teaching staff records |
| Classrooms | Physical or logical class groups linked to levels and a class teacher |
| Students | Student personal records |
| Guardians | Parent and guardian contact records |
| Student-Guardian Links | Relationships between students and their guardians |
| Admissions | Enquiry and application pipeline from first contact to offer |
| Enrollments | Formal placement of a student in a classroom for an academic year |
| Files (Metadata) | Record of uploaded documents linked to students, staff, or admissions |
| Audit Logs | System-generated tamper-proof history of all changes |
| Users & Roles | System access accounts and their permission levels |

All of the above are **fully implemented, tested, and ready for review** in Phase 1.

---

## 2. What Phase 1 Does Not Include

The following features are planned for future phases and are **not available for testing now**. Do not report their absence as bugs.

| Not in Phase 1 | Planned for |
|---|---|
| Attendance tracking | Phase 2 |
| Assessments and test scores | Phase 2 |
| Grading and report cards | Phase 2 |
| School fees and invoices | Phase 2 |
| Payment collection | Phase 2 |
| SMS notifications | Phase 2 |
| Parent/guardian portal login | Phase 2 |
| Student performance dashboards | Phase 2 |
| File upload (binary) | Phase 2 (file metadata is in Phase 1; actual upload is Phase 2) |
| Frontend web application | Phase 2 (Phase 1 is the backend API only) |

> **Important:** Phase 1 is an API — there is no website or app to open in a browser. All testing is done through a tool called **Postman** (see Section 3).

---

## 3. How to Log In

### What you need

- **Postman** (free desktop tool): download from [https://www.postman.com/downloads](https://www.postman.com/downloads)
- The **Brite SMS Phase 1 Postman collection** file (`.json`) — ask your technical team for this file
- The **server address** (URL) — your technical team will provide this (e.g. `http://localhost:3000` for local testing or a staging URL)
- Your **login credentials** (email address and password) — ask your technical team

### Step-by-step login

1. Open Postman.
2. Click **Import** (top left) and select the Postman collection file provided to you.
3. Once imported, look for the **Brite SMS** collection in the left panel.
4. Find the **Auth** folder, then click **Login**.
5. In the request body, replace the placeholder email and password with your credentials.
6. Click **Send**.
7. If login is successful, you will see a response like:
   ```
   {
     "success": true,
     "data": {
       "accessToken": "...",
       "user": { "email": "...", "name": "..." }
     }
   }
   ```
8. **Copy the `accessToken` value.** You will need it for every other request.
9. In Postman, look for a section called **Environment** or **Variables**. Set the variable named `accessToken` to the token you copied.
10. All other requests in the collection will automatically use this token.

### If your password has not been changed yet

The system will prompt you to change your password on first login. Use the **Change Password** request in the Auth folder. After changing it, log in again with the new password.

### Session expiry

Your login session lasts **15 minutes** by default (access token). If a request returns `401 Unauthorized`, your session has expired. Use the **Refresh Token** request in the Auth folder to get a new access token without logging in again, or simply log in again.

---

## 4. Suggested Testing Order

Test in this order. Each step depends on what was created in the step before it.

```
1. Authentication (login, refresh, logout)
2. School Profile
3. School Settings
4. Academic Years
5. Terms
6. Levels
7. Staff
8. Classrooms
9. Students
10. Guardians
11. Student-Guardian Links
12. Admissions
13. Enrollments
14. Files (Metadata)
15. Audit Logs
```

**Why this order matters:** You cannot enroll a student without first having an academic year, a classroom, and a student record. The system enforces these dependencies — trying to enroll into a non-existent classroom will return an error, not silently fail.

---

## 5. What Each Module Is For

### Authentication
Controls who can access the system and what they can see. Every request to the API must include a valid login token. Sessions expire after inactivity and are fully revoked on logout.

### School Profile
Stores the school's official identity: name, address, phone, email, motto, Ghana Post GPS code, and registration number. One profile per school. Only administrators can update it.

### School Settings
Configurable values that govern how the system behaves — for example, the format of student numbers (`STU-2026-0001`), whether Ghana Card is required, and which curriculum scope applies. These do not change frequently.

### Academic Years
Annual academic periods. A school creates one academic year per cycle (e.g. "2025/2026"), then activates it when the year begins and closes it at year end. Only one academic year can be active at a time.

### Terms
Academic terms within an active year (e.g. Term 1, Term 2, Term 3). Each term has start and end dates. Only one term can be active at a time within a year.

### Levels
The year groups or class stages at the school — for example, Creche, Nursery 1, Primary 1 through Primary 6, JHS 1 through JHS 3. Levels are created once and reused across years.

### Staff
Records for all teaching and non-teaching staff — name, staff number, email, phone, department, job title, and employment type. Staff records exist independently of login accounts.

### Classrooms
A classroom is one specific class group in one academic year — for example, "Primary 3 Gold (2025/2026)". Each classroom is linked to a level, an academic year, and optionally a class teacher from the staff list.

### Students
Personal records for all enrolled and prospective students — name, date of birth, gender, nationality, Ghana Card details (if collected), and student number. Student records are created independently of enrollment.

### Guardians
Contact records for parents and guardians — name, relationship type, phone, email, address, occupation, Ghana Card number. A guardian can be linked to multiple students.

### Student-Guardian Links
The formal relationship between a student and a guardian. Records here capture: relationship type (father, mother, uncle, etc.), whether the guardian is the primary contact, and whether they are an emergency contact. One student can have multiple guardians; only one can be primary.

### Admissions
Tracks the journey of a prospective student from initial enquiry to formal enrollment. Statuses follow the pipeline: **enquiry → application → offered → enrolled** (or withdrawn/rejected at any point). Admissions can be linked to an existing student record or used to gather initial interest before a student record exists.

### Enrollments
The formal placement of a student in a specific classroom for a specific academic year. An enrollment record is created either through the admissions pipeline or directly. Each student can only have one active enrollment per academic year.

### Files (Metadata)
Records of documents associated with students, staff, or admissions — for example, birth certificates, Ghana Card scans, or medical forms. Phase 1 stores the file name, type, size, and storage reference only. Actual file upload is Phase 2. Files are private by default — no public URLs are exposed.

### Audit Logs
A tamper-proof record of every significant action in the system — who did what, when, and what changed. Audit logs cannot be edited or deleted, not even by administrators. They are read-only.

---

## 6. Test Scenarios

Each scenario below uses the Postman collection. Requests are grouped into folders matching the module name. All requests that create data require a valid `accessToken` in your Postman environment.

> **How to read these scenarios:**
> - **Do:** The action to perform in Postman
> - **Expect:** What a passing response looks like
> - **Flag if:** What to report as a potential bug

---

### 6.1 School Profile

**Scenario A — View school details**
- Do: Open the **School** folder → send **Get School**
- Expect: `success: true`, school name, address, phone, and email all filled in
- Flag if: Response is empty, or returns an error code

**Scenario B — Update school details**
- Do: Open **Update School** → change one field (e.g. add a motto)
- Expect: `success: true`, updated field is reflected in the response
- Flag if: The change is not saved, or you receive a 403 Forbidden error when logged in as an administrator

---

### 6.2 School Settings

**Scenario A — View all settings**
- Do: **School Settings** folder → **Get All Settings**
- Expect: A list of key-value settings, including `students.student_number_format`, `admissions.admission_number_format`, and `academic.primary_calendar`
- Flag if: List is empty or missing expected keys

**Scenario B — Update a setting**
- Do: **Update Setting** → use the key `students.ghana_card_required` → set value to `true`
- Expect: `success: true`, updated value returned
- Flag if: Value does not change, or response is an error

---

### 6.3 Academic Years

**Scenario A — Create an academic year**
- Do: **Academic Years** folder → **Create Academic Year**
- Fill in: name (e.g. `2025/2026`), start date, end date
- Expect: New academic year created with status `pending`
- Flag if: Creation fails with an unexpected error (not a validation error)

**Scenario B — Activate an academic year**
- Do: **Activate Academic Year** (using the ID from Scenario A)
- Expect: Status changes to `active`
- Flag if: No status change, or a second activation creates two active years simultaneously

**Scenario C — Duplicate active year constraint**
- Do: Create a second academic year and try to activate it while the first is still active
- Expect: Error response — the system should block two active years at the same time
- Flag if: Two academic years end up with status `active` simultaneously

**Scenario D — Close an academic year**
- Do: **Close Academic Year** on an active year
- Expect: Status changes to `closed`
- Flag if: Status does not change

---

### 6.4 Terms

**Scenario A — Create a term**
- Do: **Terms** folder → **Create Term** → link it to an existing academic year
- Fill in: name (e.g. `Term 1`), start date, end date
- Expect: Term created with status `pending`
- Flag if: Creation fails, especially if academic year ID is valid

**Scenario B — Activate a term**
- Do: **Activate Term**
- Expect: Status changes to `active`
- Flag if: Two terms show as active at the same time within the same academic year

**Scenario C — Close a term**
- Do: **Close Term**
- Expect: Status changes to `closed`
- Flag if: Status does not change

---

### 6.5 Levels

**Scenario A — Create a level**
- Do: **Levels** folder → **Create Level**
- Fill in: name (e.g. `Primary 1`), order number (e.g. `4`), curriculum type (`GES_NACCA`, `IB`, or `BOTH`)
- Expect: Level created with `isArchived: false`
- Flag if: Creation fails or name is not saved correctly

**Scenario B — Update a level**
- Do: **Update Level** → change the name or order number
- Expect: Updated values returned
- Flag if: Change is not reflected

**Scenario C — Archive a level**
- Do: **Archive Level**
- Expect: Level is marked as archived; it should no longer appear in default list
- Flag if: Archived level still appears in standard level lists

---

### 6.6 Staff

**Scenario A — Create a staff member**
- Do: **Staff** folder → **Create Staff**
- Fill in: first name, last name, email, phone, employment type (`full_time`, `part_time`, or `contract`)
- Expect: Staff record created with a system-generated staff number (e.g. `STF-2026-0001`)
- Flag if: No staff number is generated, or creation fails with missing fields you did not provide

**Scenario B — Read a staff member**
- Do: **Get Staff** → **Get Staff by ID**
- Expect: Full staff record returned
- Flag if: Record is not found or returns wrong data

**Scenario C — Update a staff member**
- Do: **Update Staff** → change job title or phone number
- Expect: Updated values returned
- Flag if: Changes not saved

**Scenario D — Archive a staff member**
- Do: **Archive Staff**
- Expect: Staff record is archived
- Flag if: Archived staff still appears in active staff lists

---

### 6.7 Classrooms

**Scenario A — Create a classroom**
- Do: **Classrooms** folder → **Create Classroom**
- Fill in: name (e.g. `Primary 3 Gold`), level ID, academic year ID
- Expect: Classroom created
- Flag if: Creation fails with a valid level ID and academic year ID

**Scenario B — Assign a class teacher**
- Do: **Assign Class Teacher** → provide a staff member's ID
- Expect: Class teacher updated on the classroom record
- Flag if: Error when using a valid staff ID

**Scenario C — Archive a classroom**
- Do: **Archive Classroom**
- Expect: Classroom is archived
- Flag if: Classroom remains active

---

### 6.8 Students

**Scenario A — Create a student**
- Do: **Students** folder → **Create Student**
- Fill in: first name, last name, date of birth, gender
- Expect: Student created with a system-generated student number (e.g. `STU-2026-0001`)
- Flag if: No student number is assigned, or required fields cause unexpected errors

**Scenario B — Read a student**
- Do: **Get Student by ID**
- Expect: Full student record
- Flag if: Record not found or missing fields

**Scenario C — Update a student**
- Do: **Update Student** → change a field (e.g. nationality or phone)
- Expect: Change saved
- Flag if: Change not reflected

**Scenario D — View student's guardians**
- Do: **Get Student Guardians** (after linking a guardian — see Section 6.10)
- Expect: List of linked guardians with relationship details
- Flag if: Error or empty list after a guardian has been linked

**Scenario E — View student's enrollments**
- Do: **Get Student Enrollments**
- Expect: List of enrollment records for the student
- Flag if: Error or missing enrollments

**Scenario F — Archive a student**
- Do: **Archive Student**
- Expect: Student is archived and no longer appears in active student lists
- Flag if: Archived student remains in active list

---

### 6.9 Guardians

**Scenario A — Create a guardian**
- Do: **Guardians** folder → **Create Guardian**
- Fill in: first name, last name, phone number, relationship type (e.g. `mother`, `father`, `uncle`)
- Expect: Guardian created
- Flag if: Creation fails with valid fields

**Scenario B — Read a guardian**
- Do: **Get Guardian by ID**
- Expect: Full guardian record
- Flag if: Record missing or wrong

**Scenario C — Update a guardian**
- Do: **Update Guardian** → change phone or address
- Expect: Change saved
- Flag if: Change not reflected

**Scenario D — View guardian's linked students**
- Do: **Get Guardian Students** (after linking — see Section 6.10)
- Expect: List of students linked to this guardian
- Flag if: Error or empty list after linking

**Scenario E — Archive a guardian**
- Do: **Archive Guardian**
- Expect: Guardian is archived
- Flag if: Archived guardian still appears in active list

---

### 6.10 Student-Guardian Links

**Scenario A — Link a guardian to a student**
- Do: **Student-Guardians** folder → **Create Link**
- Fill in: student ID, guardian ID, relationship type, `isPrimary: true` or `false`
- Expect: Link created
- Flag if: Error with valid student and guardian IDs

**Scenario B — Set primary guardian**
- Do: **Set Primary Guardian** on an existing link
- Expect: `isPrimary: true` on the selected link; any previous primary guardian is demoted
- Flag if: Two links show `isPrimary: true` for the same student at the same time

**Scenario C — Update link details**
- Do: **Update Link** → change `isEmergencyContact`
- Expect: Change saved
- Flag if: Change not reflected

**Scenario D — Remove a link**
- Do: **Delete Link**
- Expect: Relationship removed
- Flag if: Error on deletion or link still appears

---

### 6.11 Admissions

**Scenario A — Create an enquiry**
- Do: **Admissions** folder → **Create Admission**
- Fill in: any combination of `curriculumInterest`, `enquirySource`, `notes` (all optional)
- Expect: Application created with status `enquiry`
- Flag if: Creation fails when all fields are optional

**Scenario B — Update an application**
- Do: **Update Admission** → add notes or change curriculum interest
- Expect: Changes saved
- Flag if: Status changes unexpectedly during an update

**Scenario C — Make an offer**
- Do: **Offer Admission** (using an application in `enquiry` or `application` status)
- Expect: Status changes to `offered`
- Flag if: Status does not change, or error occurs on a valid application

**Scenario D — Try to offer an already-enrolled application**
- Do: Try to offer an application that is already `enrolled`
- Expect: Error — the system should reject this
- Flag if: Status changes incorrectly

**Scenario E — Enroll from an admission**
- Do: **Enroll Admission** → provide `classroomId` and `academicYearId` (and `studentId` if not already linked)
- Expect: Status changes to `enrolled`; an enrollment record is created automatically
- Flag if: Error when all IDs are valid, or enrollment record not created

---

### 6.12 Enrollments

**Scenario A — Create an enrollment directly**
- Do: **Enrollments** folder → **Create Enrollment**
- Fill in: `studentId`, `classroomId`, `academicYearId`, `curriculumTrack`
- Expect: Enrollment created with status `active`
- Flag if: Error when all referenced records exist

**Scenario B — Duplicate enrollment constraint**
- Do: Try to create a second enrollment for the same student in the same academic year
- Expect: Error — the system should block duplicate active enrollments
- Flag if: Two active enrollments are created for one student in the same year

**Scenario C — Update enrollment status**
- Do: **Update Enrollment** → send `{ "status": "active" }`
- Expect: Status updated
- Flag if: Error or status unchanged

**Scenario D — Withdraw an enrollment**
- Do: **Withdraw Enrollment**
- Expect: Enrollment marked as `withdrawn`
- Flag if: Status does not change, or error occurs

---

### 6.13 Files (Metadata)

> Note: Phase 1 stores file information only. Actual file upload is Phase 2. Think of this as a filing cabinet index — you register that a document exists and where it is stored, without uploading the document itself.

**Scenario A — Register a file record**
- Do: **Files** folder → **Create File**
- Fill in: `originalFileName` (e.g. `birth_cert.pdf`), `mimeType` (e.g. `application/pdf`), `sizeBytes` (e.g. `2048`), `storageBucket`, `storageKey`, `ownerType` (`student`, `staff`, or `admission`), `ownerId`
- Expect: File record created with `isPublic: false`
- Flag if: Creation fails with valid fields, or `isPublic` is `true` by default

**Scenario B — View all file records**
- Do: **Get Files**
- Expect: Paginated list of file records with `sizeBytes` as a number (not an error)
- Flag if: Response contains an error about JSON serialization or `BigInt`

**Scenario C — View files by owner**
- Do: **Get Files by Owner** → provide `ownerType` and `ownerId`
- Expect: Files belonging to that specific owner
- Flag if: Returns files from other students or staff

**Scenario D — Archive a file record**
- Do: **Archive File**
- Expect: File record archived; no longer appears in default file list
- Flag if: File remains in active list after archiving

---

### 6.14 Audit Logs

**Scenario A — View audit logs**
- Do: **Audit Logs** folder → **Get Audit Logs**
- Expect: A paginated list of log entries. Each entry includes: who made the change, what action was taken, which record was affected, and timestamps.
- Flag if: Log list is empty after you have been making changes, or returns an error

**Scenario B — View a single audit log entry**
- Do: **Get Audit Log by ID**
- Expect: Full entry including before/after values for the change
- Flag if: Entry not found or before/after values are missing

**Scenario C — Try to edit or delete a log (should fail)**
- The Postman collection does not include edit or delete requests for audit logs because those routes do not exist. If anyone claims they can edit or delete an audit log, report this immediately.
- Expected result: No such ability exists in the system.
- Flag if: You find any way to modify or remove an audit log entry.

---

## 7. What Testers Should Report

When testing, report anything that does not match what the test scenario says to expect. Specifically:

### Report these types of issues

| Issue type | Example |
|---|---|
| **Incorrect response** | Created a student but no student number was assigned |
| **Unexpected error** | Received a 500 Internal Server Error on a normal operation |
| **Missing data** | Response says `success: true` but data fields are empty |
| **Wrong status** | Activated an academic year but status still shows `pending` |
| **Constraint bypass** | Created two active academic years simultaneously |
| **Wrong permissions** | A Class Teacher was able to delete a student |
| **Cross-school data leak** | A request returned data that belongs to a different school |
| **Validation too strict** | Cannot create a record with valid data because of an unexpected validation error |
| **Validation too loose** | Was able to submit clearly wrong data (e.g. a date of birth in the year 3000) and the system accepted it |

### Do not report these as bugs

- Features listed in Section 2 (not in Phase 1)
- Password reset by email (the API exists but depends on an email server not yet configured)
- Binary file upload — only metadata is in Phase 1
- The absence of a web interface — Phase 1 is API only

---

## 8. Known Limitations

These are known constraints of Phase 1 that are by design, not bugs.

| Limitation | Detail |
|---|---|
| No web interface | All testing is through Postman. A frontend is planned for Phase 2. |
| File upload not implemented | Files module stores metadata only. The actual document is not stored yet. |
| Email delivery not active | Password reset and account setup emails may not be sent in a local or staging environment unless an email server is configured. |
| Parent/guardian login not available | Guardian records exist, but guardians cannot log into the system yet. This is Phase 2. |
| Access tokens expire after 15 minutes | You will need to refresh or re-login periodically during testing. |
| Attendance, grades, fees not present | These are Phase 2 features. Do not test for them. |
| Report cards not available | Phase 2. |
| Bulk import not available | Students, staff, and guardians must be created one at a time through the API. |
| Student-school isolation | All data is siloed per school. If you are testing with multiple schools on the same server, records from one school are never visible to another. |

---

## 9. How to Submit Feedback and Bug Reports

Use the following format when reporting a bug or feedback. Send reports to your project contact via email or the agreed communication channel.

---

### Bug Report Format

```
DATE: [e.g. 2026-06-10]
TESTER NAME: [your name]
MODULE: [e.g. Admissions]
SCENARIO: [e.g. Scenario C — Make an offer]

WHAT I DID:
[Describe the steps you took, including what you entered]

WHAT I EXPECTED:
[What the guide said should happen]

WHAT ACTUALLY HAPPENED:
[What the system returned — copy the response from Postman]

ERROR CODE (if any):
[e.g. 500, 400, 403, 404]

REPRODUCIBLE:
[Yes / No / Sometimes]

SCREENSHOT / RESPONSE:
[Paste the Postman response here or attach a screenshot]
```

---

### Feedback Format (Non-Bug)

Use this for suggestions, confusion, or usability concerns:

```
DATE: [e.g. 2026-06-10]
TESTER NAME: [your name]
MODULE: [e.g. Enrollments]
TYPE: [Suggestion / Unclear behaviour / Missing field / Other]

DESCRIPTION:
[What you noticed or would like to see improved]
```

---

### Priority levels

When submitting, please indicate how urgent you feel the issue is:

- **P1 — Blocker:** The system returns an error, crashes, or produces clearly wrong data. Testing cannot continue.
- **P2 — Major:** A feature does not work correctly but testing can continue with workarounds.
- **P3 — Minor:** Something seems slightly off but data is correct. May be a display or labelling concern.
- **P4 — Suggestion:** A feature works but could be improved for real-world use.

---

*Thank you for participating in Phase 1 testing. Your feedback directly shapes how this system will serve the school.*
