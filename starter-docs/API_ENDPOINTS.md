# API Endpoints

Routes are grouped by the phase that introduced them.

# Phase 1

## Response Shape

Use a consistent response shape.

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

For paginated responses:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

---

## Auth

Base route: `/auth`

```txt
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/change-password
POST /auth/password-reset/request
POST /auth/password-reset/confirm
POST /auth/account-setup/confirm
GET  /auth/me
```

### Auth rules

- Login accepts email or phone plus password.
- Refresh token is stored in HTTP-only cookie.
- Refresh token must be rotated.
- Logout revokes current session.
- Password change revokes old sessions.
- Store only hashed refresh/reset/setup tokens.

---

## Users

Base route: `/users`

```txt
POST   /users
GET    /users
GET    /users/:id
PATCH  /users/:id
PATCH  /users/:id/deactivate
POST   /users/:id/roles
DELETE /users/:id/roles/:roleId
```

Permissions:

```txt
users.create
users.read
users.update
users.deactivate
users.manage_roles
```

---

## Roles

Base route: `/roles`

```txt
POST  /roles
GET   /roles
GET   /roles/:id
PATCH /roles/:id
POST  /roles/:id/permissions
DELETE /roles/:id/permissions/:permissionId
```

Permissions:

```txt
roles.create
roles.read
roles.update
roles.assign_permissions
```

---

## Permissions

Base route: `/permissions`

```txt
GET /permissions
GET /permissions/:id
```

Permission:

```txt
permissions.read
```

---

## School

Base route: `/school`

```txt
GET   /school
PATCH /school
```

Permissions:

```txt
school.read
school.update
```

---

## School Settings

Base route: `/school-settings`

```txt
GET   /school-settings
GET   /school-settings/:key
PATCH /school-settings/:key
```

Permissions:

```txt
school_settings.read
school_settings.update
```

---

## Document Sequences

Base route: `/document-sequences`

```txt
GET  /document-sequences
GET  /document-sequences/:type
POST /document-sequences/:type/generate
PATCH /document-sequences/:type
```

Permissions:

```txt
document_sequences.read
document_sequences.generate
document_sequences.update
```

Sequence generation must be transaction-safe.

---

## Academic Years

Base route: `/academic-years`

```txt
POST  /academic-years
GET   /academic-years
GET   /academic-years/:id
PATCH /academic-years/:id
POST  /academic-years/:id/activate
POST  /academic-years/:id/close
```

Permissions:

```txt
academic_years.create
academic_years.read
academic_years.update
academic_years.activate
academic_years.close
```

---

## Terms

Base route: `/terms`

```txt
POST  /terms
GET   /terms
GET   /terms/:id
PATCH /terms/:id
POST  /terms/:id/activate
POST  /terms/:id/close
```

Permissions:

```txt
terms.create
terms.read
terms.update
terms.activate
terms.close
```

---

## Levels

Base route: `/levels`

```txt
POST  /levels
GET   /levels
GET   /levels/:id
PATCH /levels/:id
POST  /levels/:id/archive
```

Permissions:

```txt
levels.create
levels.read
levels.update
levels.archive
```

---

## Classrooms

Base route: `/classrooms`

```txt
POST  /classrooms
GET   /classrooms
GET   /classrooms/:id
PATCH /classrooms/:id
POST  /classrooms/:id/assign-class-teacher
POST  /classrooms/:id/archive
```

Permissions:

```txt
classrooms.create
classrooms.read
classrooms.update
classrooms.assign_teacher
classrooms.archive
```

---

## Staff

Base route: `/staff`

```txt
POST  /staff
GET   /staff
GET   /staff/:id
PATCH /staff/:id
POST  /staff/:id/archive
```

Permissions:

```txt
staff.create
staff.read
staff.update
staff.archive
```

---

## Students

Base route: `/students`

```txt
POST  /students
GET   /students
GET   /students/:id
PATCH /students/:id
POST  /students/:id/archive
GET   /students/:id/guardians
GET   /students/:id/enrollments
```

Permissions:

```txt
students.create
students.read
students.update
students.archive
```

---

## Guardians

Base route: `/guardians`

```txt
POST  /guardians
GET   /guardians
GET   /guardians/:id
PATCH /guardians/:id
POST  /guardians/:id/archive
GET   /guardians/:id/students
```

Permissions:

```txt
guardians.create
guardians.read
guardians.update
guardians.archive
```

---

## Student-Guardian Relationships

Base route: `/student-guardians`

```txt
POST  /student-guardians
PATCH /student-guardians/:id
DELETE /student-guardians/:id
POST  /student-guardians/:id/set-primary
```

Permission:

```txt
student_guardians.manage
```

---

## Admissions

Base route: `/admissions`

```txt
POST  /admissions
GET   /admissions
GET   /admissions/:id
PATCH /admissions/:id
POST  /admissions/:id/offer
POST  /admissions/:id/enroll
```

Permissions:

```txt
admissions.create
admissions.read
admissions.update
admissions.approve
admissions.enroll
```

---

## Enrollments

Base route: `/enrollments`

```txt
POST  /enrollments
GET   /enrollments
GET   /enrollments/:id
PATCH /enrollments/:id
POST  /enrollments/:id/withdraw
```

Permissions:

```txt
enrollments.create
enrollments.read
enrollments.update
enrollments.withdraw
```

---

## Files Metadata

Base route: `/files`

```txt
POST  /files
GET   /files
GET   /files/:id
GET   /files/owner/:ownerType/:ownerId
POST  /files/:id/archive
```

Permissions:

```txt
files.upload
files.read
files.archive
```

Do not implement binary upload unless explicitly instructed. Phase 1 is metadata only.

---

## Audit Logs

Base route: `/audit-logs`

```txt
GET /audit-logs
GET /audit-logs/:id
```

Permission:

```txt
audit_logs.read
```

No create/update/delete public endpoints. Audit creation should happen internally in backend services.

---

# Phase 2 Stage 1a — Labels and Attendance

> **Renamed 17 September 2026** from `API_ENDPOINTS_PHASE_1.md`. The file
> documents every phase's routes, so the `PHASE_1` name had become wrong. Some
> frozen Phase 1 artifacts (the handoff checklist, the build brief, the schema
> review, the build plan) still cite the old name and were deliberately left
> untouched — they are historical records of what was delivered, not live
> references. This note is the bridge for anyone arriving from one of them.

## Labels

Base route: `/labels`

```txt
POST   /labels
GET    /labels?category=fee|income|expenditure&includeArchived=true
GET    /labels/:id
PATCH  /labels/:id
POST   /labels/:id/archive
POST   /labels/:id/restore
```

Permissions:

```txt
labels.create
labels.read
labels.update
labels.archive     ← governs BOTH archive and restore
```

Notes:

- `category` is **immutable after creation** and is absent from
  `UpdateLabelDto`; the global `forbidNonWhitelisted` validation pipe rejects
  a PATCH that carries it with a 400.
- Names are normalised on write (trimmed, internal whitespace collapsed) and
  are unique per school **per category**, case-insensitively. That rule is the
  raw-SQL index `uq_label_school_category_name_lower`; a collision surfaces as
  a 409 naming the category.
- Archiving a label that a consumer already references is allowed. Archived
  labels drop out of pickers; existing references still resolve.

## Attendance

Base route: `/attendance`

```txt
GET  /attendance/classrooms?academicYearId=
GET  /attendance/register?classroomId=&date=YYYY-MM-DD
PUT  /attendance/register
GET  /attendance/summary/student/:studentId?termId=
GET  /attendance/summary/classroom/:classroomId?termId=
GET  /attendance/summary/classroom/:classroomId/export?termId=&format=csv
GET  /attendance/register/grid?classroomId=&termId=&from=&to=&format=
POST /attendance/terms/:termId/reopen
```

**Sessions, not days.** A register row covers a day and states a status for
each of its two SESSIONS — morning and afternoon. Every reported figure is
over sessions: `sessionsMarked` (= `2 × daysMarked`), `sessionsPresent`,
`sessionsAbsent`, and `attendanceRate = sessionsPresent / sessionsMarked` to
1 d.p. Alongside them, each day falls in exactly one shape bucket —
`daysFullyPresent`, `daysFullyAbsent`, `daysPartial` — and `daysPartial` is
the figure sessions exist to surface: "eleven children left at lunch this
term" as a number rather than an inference.

When the two sessions disagree the rule is to **count the sessions**, not to
resolve the day either way: "present if either" would make a child who goes
home every lunchtime look perfect, and "present only if both" would let one
late afternoon erase a whole morning.

There is deliberately **no half-day or sessions-applicable flag**. A Crèche or
nursery class that genuinely runs mornings only marks both sessions
identically — that is **expected, not a bug and not a data-entry error**, and
because 2p/2n = p/n it yields exactly the rate a morning-only count would.

The denominator caveat is unchanged and still applies: `sessionsMarked` counts
sessions somebody marked, **not** school sessions in the term. Brite still has
no school calendar.

Permissions:

```txt
attendance.read        ← read registers/summaries for classrooms you teach
attendance.read_any    ← read for any classroom
attendance.mark        ← create/amend for classrooms you teach
attendance.mark_any    ← create/amend for any classroom
```

**Authorisation is two-layered.** `PermissionsGuard` answers only "may this
caller reach the endpoint", using `RequireAnyPermission('attendance.read',
'attendance.read_any')` — a Class Teacher holds the first, a Headteacher the
second, and neither holds both, which all-of semantics cannot express.
`AttendanceService` then answers "which classrooms", by resolving the caller's
linked `Staff` id and comparing it to `Classroom.classTeacherId`. Holding the
`_any` variant bypasses that check entirely. This is Brite's first row-level
authorisation; the guard still never learns about resources.

`PUT /attendance/register` is **one endpoint for both marking and amending**:

```jsonc
{
  "classroomId": "…",
  "date": "2026-05-11",
  "marks": [{
    "enrollmentId": "…",
    "status": "present|absent|late|excused",   // the MORNING
    "reason": "…?",                            // the MORNING's note
    "afternoon": { "status": "…", "reason": "…?" }   // optional
  }]
}
```

`status`/`reason` set the **morning**. **An omitted `afternoon` means "mirror
the morning" — on create AND on amend.**

⚠️ **The footgun, stated rather than buried.** Because omission means mirror on
amend too, a client that corrects only the morning and omits an afternoon it
had previously set will **silently reset that afternoon**. Send the complete
effective state of every row; never send a partial patch and expect the unsent
half to survive. The alternative — "omitted means preserve" — is worse, because
the endpoint's meaning would then depend on whether the row already exists and
a payload would no longer describe a register state on its own. `amendedCount`
in the response makes an unintended reset visible in the same request rather
than at term end.

There is deliberately no separate `PATCH /attendance/register/afternoon`: a
second write path into the same rows would need its own authorisation check,
its own audit branch and its own term-lock check, and those three must not
drift from the ones here.

It upserts on `(enrollmentId, attendanceDate)`, so re-sending an unchanged
register writes nothing and audits nothing. The response adds
`createdCount` / `amendedCount` / `unchangedCount` / `absentCount` to the
register view — `absentCount` is over **sessions**, so a child absent all day
contributes 2 and one who went home at lunch contributes 1. Audit entries are
written **only for rows that actually changed** — `attendance.marked` for
creates, `attendance.amended` for changes, whose `changes.before`/`after` carry
**all four fields on both sides** (not a diff) and whose `metadata.sessions`
names which sessions actually moved, e.g. `["afternoon"]`.

Every Stage 1a validation applies to the **row**, not per session: the future
date check, the active-enrollment check and the term lock are all decided
before either session is looked at.

### Exports and the printable register

`?format=` is resolved against an export registry rather than a switch in the
controller. An unknown value is a **400 that lists the valid ones**, which is
also how a client discovers them. Adding a format is one registry entry.

| Route | `format=` | Returns |
|---|---|---|
| `…/export` | `csv` (default) | `text/csv` — one row per student plus a class total |
| `…/register/grid` | *(omitted)* | JSON `ClassroomRegisterGrid` |
| `…/register/grid` | `register` | `text/html` — the printable register |

`GET /attendance/register/grid` is a **different read**, not a different
formatter over the term summary: a grid needs per-date detail that a summary
view does not carry. It returns students down, marked dates across, and an
`{ am, pm }` cell per date. Only dates somebody **marked** become columns —
Brite cannot tell a holiday from an unmarked day, so it prints neither.
`from`/`to` are clamped into the term. Same row-level authorisation as every
other read.

`format=register` renders **print-styled HTML** that the browser prints to PDF:
A4 landscape, a fortnight of dates per page, student name and number repeated
as frozen left columns on every page, two-glyph `P·A` cells with a legend, per
student and class totals, and a footer carrying the school, classroom, term,
range and the days-marked caveat, because a printed sheet leaves the app and
has to be readable on its own. **No server-side PDF**: Brite has no PDF library
and a PDF pipeline is a bigger change than this feature. The registry's
`string | Buffer` return type is the seam that lets a real server-side PDF
arrive later as a third format without touching the dispatch.

Rejections:

| Condition | Status |
|---|---|
| Date in the future | 400 (service check — Postgres cannot put `CURRENT_DATE` in a `CHECK`) |
| Same student twice in one payload | 400 |
| No term of the classroom's year covers the date | 409 |
| Term is `draft` | 409 — the term has not started |
| Term is `closed` and not reopened | 409 — names the remedy |
| An enrollment is not active in that classroom | 409 |
| Caller is not the class teacher and lacks `mark_any` | 403 — names the classroom |

`POST /attendance/terms/:termId/reopen` takes `{ "reason": "…" }` (minimum 10
characters, mandatory) and is **Super Admin only, enforced by ROLE**, not by a
permission key — `SCHOOL_ADMIN` is seeded with every permission and would
inherit a new key automatically. It does **not** change `Term.status`
(`active` would collide with `uq_one_active_term_per_school`); the reopen is a
fact in the immutable audit trail under `attendance.term_reopened`, and
closing the term again writes a newer `terms.closed` entry that outranks it
and re-locks the register. There is no reopened state to unwind.

---

# Phase 2 Stage 1b — Fees, Billing and Invoices

## Money on this boundary

Every amount is a **string**, never a JSON number, in both directions.
`Decimal(12,2)` in Postgres, `Prisma.Decimal` in the service, a fixed-2dp
string on the wire. There is **no `currency` field** anywhere: Brite is a
Ghana-only product and one frontend formatter renders GH₵ everywhere.

## Fees

Base route: `/fees`

```txt
POST   /fees/types
GET    /fees/types?includeArchived=
GET    /fees/types/:id
PATCH  /fees/types/:id
POST   /fees/types/:id/archive
POST   /fees/types/:id/restore

POST   /fees/school-fees
GET    /fees/school-fees?academicYearId=&termId=&levelId=&includeArchived=
GET    /fees/school-fees/:id
PATCH  /fees/school-fees/:id
POST   /fees/school-fees/:id/archive
POST   /fees/school-fees/:id/restore
POST   /fees/school-fees/:id/reconcile

GET    /fees/assignments/:id
PATCH  /fees/assignments/:id          { amountDue }

POST   /fees/payments
GET    /fees/payments?studentId=&feeAssignmentId=&from=&to=
GET    /fees/payments/assignment/:feeAssignmentId
POST   /fees/payments/:id/reverse     { reason }

GET    /fees/summary?levelId=&academicYearId=&termId=
GET    /fees/bill/:studentId?termId=
GET    /fees/ledger?academicYearId=&termId=
```

Permissions:

```txt
fee_types.create | read | update | archive     ← archive governs restore too
school_fees.create | read | update | archive
fee_assignments.read
fee_assignments.reconcile                       ← also governs PATCH amountDue
fee_payments.create | read | reverse
fees.report                                     ← summary and ledger
```

### The rules worth knowing before calling any of this

**A fee binds to a LEVEL, not a classroom.** `POST /fees/school-fees` creates
the fee *and* one `FeeAssignment` per active enrollment in every classroom of
that level, in one transaction, and returns `assignedCount`. Two sections of
the same grade always pay the same.

**Assignment freezes the price.** `FeeAssignment.amountDue` is copied from
`SchoolFee.amount`, not read through. `PATCH /fees/school-fees/:id` with a new
amount therefore affects **future** assignments only — bills already handed to
parents do not change and receipts already issued still reconcile.

**Reconcile closes the late-enrollment hole.** A student who enrols after the
fee was created has no assignment. `POST …/reconcile` is idempotent
(`@@unique([schoolFeeId, enrollmentId])` + `skipDuplicates`) and bills late
joiners at the fee's *current* price. The level summary's
`unassignedStudentCount` is what makes the manual step safe — a reconcile
nobody remembers to run is a silent revenue hole.

**Overpayment is refused, not held as credit.** `POST /fees/payments` takes a
`SELECT … FOR UPDATE` row lock on the assignment before summing, so two
concurrent payments cannot both see the same remaining balance. A payment over
the balance returns 409 naming the maximum.

**Corrections are reversing entries.** `POST /fees/payments/:id/reverse`
writes a *new* negative row naming what it reverses; the original is never
edited or deleted and keeps its receipt number. Every balance is therefore one
signed `SUM` with no exclusion subquery.

**Arrears are computed, never rolled over.** `GET /fees/bill/:studentId`
returns this term's fees as lines plus `broughtForward` — the outstanding sum
over *earlier* terms — as a figure. No synthetic "arrears" assignment is ever
created, so the product has exactly one answer to "what does this child owe".
Arrears follow the **student**, so a child who leaves and returns carries the
debt.

**The ledger is three columns.** `billed`, `collected`, `outstanding`, grouped
by (fee type, term). There is no fourth column and nothing named "Balance".

## Invoices

Base route: `/invoices`

```txt
POST /invoices                { enrollmentId, termId, feeAssignmentIds[], dueOn?, notes? }
GET  /invoices?studentId=&termId=&status=&paymentState=
GET  /invoices/:id
POST /invoices/:id/cancel     { reason }
POST /invoices/:id/correct    { reason, feeAssignmentIds?, dueOn?, notes? }
```

Permissions:

```txt
invoices.create
invoices.read
invoices.cancel
```

`correct` requires **both** `invoices.cancel` and `invoices.create` — it is
literally both acts — and deliberately has no key of its own.

### What an invoice is, and is not

An invoice is a **formal document over a frozen SET of fee assignments**. It
stores **no money**: `billed`, `collected` and `outstanding` are computed on
every read through `lines → FeeAssignment → FeePayment`, and `paymentState`
(`pending` / `partially_paid` / `paid`) is derived the same way. Only `status`
(`issued` / `cancelled`) is stored, because that is an act the school takes
rather than a consequence of the money.

What it adds that a frozen assignment does not already have is the **frozen
set**. "This term's bill" as a query has no memory, so a later reconcile
silently changes what yesterday's bill said. Enumerated lines cannot change
underneath a number.

**One term per invoice.** Earlier unpaid terms appear as the informational
`broughtForward` figure, never as lines — putting them on a second invoice
would formally bill the same debt twice.

**An assignment sits on at most one live invoice**, enforced by the partial
unique index `uq_one_live_invoice_line_per_assignment`.

**The freeze guard.** While an assignment is on a live invoice, its
`amountDue` cannot be edited — `PATCH /fees/assignments/:id` returns 409
naming the invoice. This is what makes a read-through invoice a stable
document without copying any money onto it: the invoice is not a copy of the
money protected from drift, the invoice is what *makes* the money immutable.

### Cancelling

`POST /invoices/:id/cancel` voids the invoice's lines (releasing its
assignments and lifting the freeze), sets `status = cancelled`, and records the
reason in `audit_logs` under `invoices.cancelled`.

**It does not touch money.** Payments recorded against the covered assignments
keep their rows, amounts and receipt numbers. The response returns
`paymentsRetained` and `paymentsRetainedTotal` so the UI can say so *before*
the act. Cancellation is terminal — re-billing is a new invoice.

Because the payment state is derived, re-invoicing the released assignments
produces an invoice that already reads `partially_paid`: the payments never
went anywhere.

### Correcting — cancel and reissue as one act

`POST /invoices/:id/correct` does all of this in **one transaction**:

1. voids the original's lines, releasing its assignments;
2. cancels the original with the supplied reason;
3. issues a new invoice with a new number over the (possibly corrected) set;
4. links the new one back with `supersedesInvoiceId`.

Two audit entries are written, one per document: `invoices.cancelled` on the
original (carrying `supersededBy`, which is what distinguishes a correction
from a plain cancel) and `invoices.corrected` on the replacement.

`GET /invoices/:id` returns the **whole chain in both directions** from any
invoice in it:

```jsonc
{
  "supersedesInvoiceId": "…",       // what this replaced
  "supersededByInvoiceId": "…",     // what replaced this
  "chain": { "supersedes": [ … ], "supersededBy": [ … ] }
}
```

Only **one column** exists for this (`supersedes_invoice_id`, on the newer
invoice). The forward direction is the Prisma back-relation, so there is no
second column that could disagree with the first, and `@unique` on the FK
keeps the chain linear.

`correct` and `cancel` both require an `issued` invoice. Calling either on one
that has already been superseded returns 409 **naming the invoice that
replaced it**, so the caller is told where to go rather than merely refused.

---

# Phase 2 — SMS Notifications

## Consent comes first, and it is a record

**No guardian receives any message until consent is recorded against their
name.** Inbound SMS is not built — there is no webhook, no short code, no
keyword parser — so a guardian cannot reply YES to opt in. Staff capture it on
their behalf, and the audit trail is the proof.

```txt
POST   /guardians/:id/consent    { smsConsentMethod }
DELETE /guardians/:id/consent    { reason }
```

Permission: `guardians.consent_manage` — separate from `guardians.update`,
because consent is a legal record attributable to the member of staff who
obtained it, not an ordinary field edit.

`smsConsentMethod` is required and must be one of `verbal_at_enrollment`,
`written_form`, `verbal_in_person`, `verbal_by_phone`, `sms_reply`. The method
matters because it is what a school would have to produce if anyone asked *how*
consent was obtained; a boolean answers "may we message them" and not "on what
basis".

**Consent lives on `Guardian`, not on the `StudentGuardian` link**, even though
`canReceiveSms` lives on the link. Consent is a property of the PERSON: a
guardian who consented for one child but not another has not given coherent
consent, and a withdrawal that has to find N link rows is a withdrawal that can
miss one. `canReceiveSms` remains per-child reachability and is **gated** by
it — setting it true for a guardian with no consent returns 409.

**Withdrawal takes effect on the next send, not eventually.** It clears the
flag, turns off every link, and **cancels anything already queued**, all in one
transaction. There is no cached consent: the enqueue path re-reads it from the
database for every single message.

Audit: `guardian.sms_consent_granted` / `guardian.sms_consent_revoked`.

## Notifications

```txt
GET  /notifications?status=&trigger=&guardianId=&studentId=&from=&to=&page=&limit=
GET  /notifications/counts?since=
GET  /notifications/:id
POST /notifications/fee-reminders    { termId, levelId?, studentId? }
POST /notifications/absence-alerts   { classroomId, date }
POST /notifications/dispatch
```

Permissions: `notifications.read`, `notifications.trigger`. They are separate
because triggering is **cost-bearing** — every fire is a paid message — and
seeing the log is not the same authority as spending the school's money.

### The outbox

One table, `notification_messages`, which is both the queue and the delivery
record — they are the same row at different points in its life, and splitting
them means reconciling two tables that must never disagree.

`toPhone` and `body` are **frozen at queue time**. When a parent says "I never
got a message about the fees", the answer has to be what was actually sent to
which number, not a re-render from data that has since changed.

Statuses: `queued` → `sending` → `sent` (the gateway accepted it) → `delivered`
(confirmed on the handset, where the gateway reports that at all). `failed` is
"we tried and it did not work"; **`suppressed` is "we never tried"** — no
consent, or no usable number — and the two are deliberately distinct because
they need different fixes.

### Delivery, retry and cost

An in-process poller claims due rows every 15 seconds with
`SELECT … FOR UPDATE SKIP LOCKED`, which keeps it correct if a second instance
is ever run: two pollers cannot claim the same row, so nobody is charged twice.
It assumes the API is a long-lived process, which the deployment guide confirms
(PM2 / Docker / systemd); on a serverless host this design would be wrong.

**Maximum 3 attempts**, with backoff of 1 minute then 5 — exponential in shape
but deliberately short, because the thing being retried is usually a transient
blip and an absence alert that arrives at 4pm has missed its purpose. Terminal
failures (invalid number, unroutable, rejected content) are **not retried**:
the adapter classifies them, and retrying a bad number three times buys three
failures at full price.

`segmentCount` is computed and stored at queue time because SMS bills per
**segment**: 160 GSM-7 characters, or **70** the moment one non-GSM-7 character
appears. A curly apostrophe pasted from a document turns a one-segment reminder
into three, silently.

### Triggers in v1

| Trigger | How | Note |
|---|---|---|
| `fee_receipt` | Automatic on `FeePayment` create | Enqueued **after** the payment transaction commits — a gateway problem must never roll back a recorded payment. Never fires for a reversal |
| `fee_reminder` | Manual, per level or per student | Cost- and judgement-bearing. Only students who actually owe something. Deduped per student per term per day |
| `attendance_absence` | Manual, over a **saved** register | Condition is "**either session** has them absent that day", and the message says which — `all day`, `morning only` or `afternoon only`. Either-session because a child who went home at lunch is exactly what a parent wants to hear about, and it cannot under-report; for pre-session rows, whose two sessions were backfilled equal, it selects precisely the same students the day-level condition did. Deduped per child per **date**, not per session, so an all-day absence is one message. A human fires it: marking is live and error-prone, and a mistyped row corrected ten seconds later would already have cost money and alarmed a parent |
| `password_reset` | Automatic on token creation | See below |

`announcement` and `account_setup` exist in the enum and go through the same
path; no endpoint exposes them yet.

### The gateway is swappable

`SmsGateway` is an interface Brite owns, bound once in `NotificationsModule`.
The shipped adapter is `LoggingSmsGateway` — a **sandbox** that logs what it
would have sent and returns a synthetic id. It sends nothing and costs nothing,
which is what makes the whole path testable before a vendor contract exists.
Swapping in a real provider changes that one binding and adds one file.

`send` returns a **per-message** outcome (a batch of 300 partly succeeds) and
the **adapter** classifies failures as retryable or terminal, because only it
knows its vendor's error taxonomy. `fetchStatus` is optional.

### Password reset no longer leaks its token

`POST /auth/password-reset/request` used to return
`{ …, _devToken: rawToken }` under a `// TODO: Phase 2` — the one place Brite
was supposed to message a human, it handed the secret back to whoever asked,
which made the reset flow usable by anyone who knew an email address.

The token now leaves only through the notification layer. The response is
`{ message: 'If the account exists, a reset token has been sent' }` and is
**identical in every branch** — no such user, no deliverable channel, or a
successful send — because varying it would leak which accounts exist.
`AuthToken.channel` now records `sms` when a phone number exists, where Phase 1
wrote `email` unconditionally while sending nothing at all.
