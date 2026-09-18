# Phase 1B Backend Proposal — Admission Numbers, Admission State Machine, Archive Restoration

**Status:** PROPOSAL — nothing in this document is implemented. No schema, DTO,
or migration changes have been made.
**Date:** 2026-08-14
**Scope guard:** No Phase 2 features. No route path changes. UI changes limited
to what these three capabilities require.

---

## 1. Summary

Three capabilities, all closing gaps found during stakeholder-testing prep:

1. **Admission numbers become automatic.** Every admission gets `ADM-NNNN` at
   creation from the existing (currently unwired) document sequence. The "—"
   column disappears; numbers are unique per school; existing null records are
   backfilled. Student/staff numbers get a lighter treatment: auto-fill only
   when left blank.
2. **The admission pipeline becomes a real state machine.** Today
   `PATCH /admissions/:id` accepts any `status` value with **no transition
   validation and no field cleanup** — that unguarded hole is how an admission
   ended up needing raw SQL to un-enroll. Dedicated transition endpoints
   (offer, revert-offer, reject, withdraw, enroll, revert-enrollment) replace
   it, each with validation, cleanup, and an audit entry. `withdrawn` is added
   to the `AdmissionStatus` enum.
3. **Archive gets an inverse.** `POST :id/restore` for levels, classrooms,
   staff, students, and guardians. Files stay one-way (recommended). Fixed
   restore states, no new columns. Three list endpoints need an
   `includeArchived` query param first, because they currently hide archived
   rows entirely — without that, restore is unreachable from any UI.

What users see: admission numbers appear immediately and are searchable;
Reject/Withdraw/Revert buttons appear on admission rows according to state;
archived records become visible on demand and recoverable; operator mistakes
stop requiring database surgery.

---

## 2. Item 1 — Admission numbers

### When to assign: at creation

**Recommendation: assign at creation.** The pipeline does not argue for
assignment at Offer:

- An enquiry is already a record users list, search, and discuss — "the
  admission with the dash" is exactly the referenceability gap this feature
  removes. Numbering at Offer keeps the dash for the two earliest stages,
  which is most of the funnel.
- Assignment at Offer creates a second numbering trigger (offer endpoint) and
  a mixed population (numbered offers, unnumbered enquiries) forever.
- The counter-argument — "only serious candidates deserve numbers, and
  enquiry-heavy funnels burn the sequence" — is aesthetic. Numbers must be
  unique, not dense, and an enquiry log with reference numbers is normal
  school practice.

`CreateAdmissionDto` today has no `admissionNumber` field; it stays that way.
Creation always auto-assigns.

### Atomicity under concurrent creation

Use the mechanism `DocumentSequencesService.generateNext` already implements,
wrapped in the **same transaction as the admission insert**:

```
prisma.$transaction: 
  UPDATE document_sequences SET current_number = current_number + 1
    WHERE school_id = ? AND type = 'admission_number'   ← row lock
  INSERT INTO admission_applications (…, admission_number = 'ADM-' || padded)
  INSERT audit_log
```

Postgres serialises the two `UPDATE`s on the sequence row with an ordinary
row-level lock: the second concurrent transaction blocks until the first
commits, then reads the incremented value. Two simultaneous enquiries cannot
receive the same number.

**Failure modes:**
- *Load:* writers queue on one row per (school, type). Worst case is brief
  serialisation latency, not corruption. At single-school scale this is
  irrelevant; even at hundreds of schools each school has its own row.
- *Gaps:* if the transaction aborts after the increment would have committed
  (it can't — same transaction) there is no gap; but a **manually edited**
  number can collide with a future sequence value (see Editability). Handle
  with a bounded retry: on `P2002` during create, re-increment and retry, max
  3 attempts, then 409. Numbers are unique, not gap-free — gap-freedom is not
  a requirement and pursuing it (e.g. reusing aborted numbers) is a trap.

### Uniqueness constraint

`@@unique([schoolId, admissionNumber])` — **expressible directly in the Prisma
schema**, mirroring `@@unique([schoolId, staffNumber])`. `admissionNumber` is
nullable and Postgres treats NULLs as distinct, so pre-backfill rows don't
collide. This is a normal unique index, **not** a partial index — it does not
join the raw-SQL set.

### Backfill

One data migration (a script, not schema DDL):

1. Select admissions with `admission_number IS NULL`, ordered by
   `(application_date, created_at)` — oldest first, so numbers roughly follow
   chronology.
2. Assign each the next value via the same sequence-increment transaction.
3. The sequence's `current_number` ends at the true maximum, so the next live
   creation continues cleanly.

Backfilling **does** consume sequence values, and that is correct — the
sequence must end above every issued number or future creations collide. The
demo DB currently has ADM-0001/ADM-0002 issued and `current_number = 2`; four
null records would backfill as ADM-0003…ADM-0006, sequence ends at 6.
`prisma/seed-demo.ts` must be updated in the same change (it hardcodes two
numbers and `current_number = 2`).

### Editability after auto-assignment

**Keep the field editable** via the existing `PATCH` (`UpdateAdmissionDto`
already has it). Schools reconcile against paper records; locking the field
buys nothing. A manual value that collides hits the unique index → `P2002` →
**409 with a specific message** ("Admission number ADM-0004 is already in use")
surfaced by the existing error handler and `applyFieldErrors`. The bounded
retry above absorbs the case where a manual number sits in the sequence's
future path.

### Students and staff: recommend *fill-if-blank*, not forced auto

**Recommendation: do not give student/staff numbers the identical treatment.**
Their numbers frequently originate outside the system — existing school
records, GES numbering conventions — and Phase 1 data entry is partly
migration of historical records. Forcing auto-generation would fight that.
Instead:

- `studentNumber` / `staffNumber` become **optional** on the create DTOs;
  blank → auto-generate from the already-existing sequences (`STU-`, `STF-`),
  provided → validated as today.
- The dialogs get placeholder text "Leave blank to auto-generate".

This wires the dormant sequences without breaking historical-number entry.
Admissions differ because the number is system-native — nobody arrives with a
pre-existing admission number.

---

## 3. Item 2 — Admission state machine

### The current hole, stated plainly

`UpdateAdmissionDto.status` lets any caller set any status with no validation
and no cleanup — `enrolled → enquiry` in one PATCH, leaving `enrolledAt`,
`offeredAt`, and the created enrollment all orphaned. **The state machine is
only real if that field is removed from the PATCH DTO in the same change.**
(The frontend edit dialog does not send `status`, so nothing breaks.)

Also noteworthy: `offer()` today writes `offeredAt` but never `approvedBy` /
`approvedAt` — those columns exist and are permanently null. The offer
endpoint should start recording the acting user in both.

### Proposed enum change

Add **`withdrawn`** to `AdmissionStatus`
(`enquiry | application | offered | rejected | enrolled | withdrawn`).

The guide is not wrong — it describes a state the schema forgot. *Rejected*
(school declines the family) and *withdrawn* (family declines the school) are
different facts with different follow-ups: a rejected family reapplying is a
fresh decision; a withdrawn family returning is a warm lead. Collapsing both
into `rejected` loses the distinction permanently, and the pipeline report a
head teacher actually wants ("how many offers did we lose?") becomes
unanswerable. Enum addition in Postgres is additive and safe
(`ALTER TYPE … ADD VALUE`); note it is also **irreversible** — Postgres cannot
drop enum values — so this is a decide-once change.

### Transition table

| # | From | To | Endpoint | Sets | Clears | Notes |
|---|------|----|----------|------|--------|-------|
| 1 | enquiry | application | `POST :id/apply` | — | — | Formalises the paperwork stage the guide currently omits |
| 2 | enquiry | offered | `POST :id/offer` *(existing)* | `offeredAt`, `approvedBy`, `approvedAt` | — | Skipping `application` stays legal (current behaviour) |
| 3 | application | offered | `POST :id/offer` *(existing)* | as above | — | |
| 4 | offered | application | `POST :id/revert-offer` | — | `offeredAt`, `approvedBy`, `approvedAt` | **The requested reversal.** Lands on `application` even if the offer came straight from `enquiry` — an offer implies the application was effectively considered |
| 5 | enquiry, application, offered | rejected | `POST :id/reject` | — | — | School declines; from `offered` this is offer-rescinded. Optional `notes` in body |
| 6 | enquiry, application, offered | withdrawn | `POST :id/withdraw` | — | — | Family declines. Optional `notes` |
| 7 | offered | enrolled | `POST :id/enroll` *(existing)* | `enrolledAt`, `studentId` (if supplied) | — | Unchanged |
| 8 | enrolled | offered | `POST :id/revert-enrollment` | — | `enrolledAt` | **Guarded** — see below |

**Terminal states: `rejected` and `withdrawn`.** No un-reject / un-withdraw. A
family that returns gets a new admission record (reference the old one in
notes); resurrecting terminal records would corrupt funnel history. `enrolled`
is terminal *except* via the guarded row 8.

### What reversal cleans up — and what it keeps

- **`studentId` is retained on every reversal.** It is a factual link to a
  person, entered by a user — not an artifact of the stage. Clearing it
  destroys data entry for no benefit; row 4 and row 8 both keep it. (The
  raw-SQL revert during testing cleared `studentId` only because that specific
  record's *prior* state had it null — that was state restoration, not
  policy.)
- `revert-offer` clears exactly the fields `offer` sets: `offeredAt`,
  `approvedBy`, `approvedAt`.
- `revert-enrollment` clears exactly what `enroll` set on the admission:
  `enrolledAt`. It does **not** touch the enrollment record itself (see
  guard). `admissionNumber` and `notes` are never cleared by anything.

### The hard guard on `enrolled → offered`

You lean *forbidden outright*. **I recommend permitted-only-after-withdrawal,
and here is the argument:** operator mistakes are the entire reason this
feature exists — the wrong child enrolled, the wrong classroom year — and
forbidding reversal outright recreates the exact situation we just lived
through, where correcting a mistake required raw SQL. Under
forbidden-outright, the recovery path is: withdraw the enrollment (that
module allows it), after which the admission still says `enrolled` forever,
pointing at a withdrawn enrollment — the pipeline now lies and nothing in the
API can ever fix it.

Proposed guard, precisely: `revert-enrollment` succeeds **only if no
enrollment with `status = 'active'` exists for this admission's
`(studentId, academicYearId)` pair** — i.e. the enrollment must already have
been withdrawn through the enrollments module, with its own exit date, reason,
and audit trail. While a live enrollment exists: **409** with "Withdraw the
enrollment first." The admission endpoint never mutates enrollment rows.

This is strictly safer than forbidden-outright in outcome terms: the
enrollment teardown still happens through the enrollment module's own
controls; the admission merely stops lying afterwards. If you still prefer
forbidden, implementation is one guard clause simpler — but you keep the
permanent-lie failure mode.

### Audit

The existing mechanism is **manual-per-method** — each service method calls
`auditLogs.create` with before/after. Nothing structural needs adding; each
new endpoint writes one entry with a distinct action
(`admissions.offer_reverted`, `admissions.rejected`, `admissions.withdrawn`,
`admissions.enrollment_reverted`, `admissions.application_submitted`) and a
`changes` payload of `{ before: { status, offeredAt… }, after: {…} }`,
following the existing pattern exactly.

### API shape: dedicated endpoints

**Recommendation: dedicated `POST :id/<transition>` endpoints**, not a
generalised PATCH:

- It is the established pattern — `:id/offer` and `:id/enroll` already exist;
  a generalised PATCH would coexist awkwardly with them or force their
  deprecation (route changes are out of scope).
- Permissions map per-transition: `offer`/`revert-offer` under the existing
  `admissions.approve`; `apply`/`reject`/`withdraw` under `admissions.update`;
  `enroll`/`revert-enrollment` under `admissions.enroll`. No new permission
  rows, no role reseeding.
- Transition-specific bodies (reject/withdraw take optional `notes`) and
  distinct audit actions come free.
- A generalised `PATCH {status}` re-implements the same matrix behind one
  opaque endpoint with worse 403 granularity and a single mushy audit action.

And, as above: **`status` is removed from `UpdateAdmissionDto`** so the
machine cannot be bypassed.

---

## 4. Item 3 — Archive restoration

### Restore target states

| Module | Archive today | Restore proposal |
|---|---|---|
| Staff | `status = terminated`, `archivedAt` set | **Fixed: `status = active`, `archivedAt = null`** |
| Students | `status = withdrawn`, `archivedAt` set | **Fixed: `status = active`, `archivedAt = null`** |
| Levels | `isActive = false` | `isActive = true` |
| Classrooms | `isActive = false` | `isActive = true` |
| Guardians | `archivedAt` set (links untouched) | `archivedAt = null` (links were never touched) |
| Files | `archivedAt` set | **No restore — stays one-way** (below) |

**Fixed restore state, not stored-previous — for both staff and students.**
The stored-previous alternative (a `previousStatus` column) earns nothing
today: for staff, `UpdateStaffDto` has no `status` field and archive is the
*only* writer, so the pre-archive status is `active` in every reachable case —
`on_leave` and `resigned` are currently **unreachable via the API entirely**
(pre-existing dead enum values, flagged in §10). For students the same
argument holds (`UpdateStudentDto` has no status either). Fixed `active` is
simple, honest about what the system can actually represent, and adds zero
schema. A student who was *withdrawn but never archived* is untouched by all
of this — `restore` applies only to rows with `archivedAt` set (or
`isActive = false`), which withdrawal alone does not produce.

### Restore-failure matrix

The instinct that restore collides with the world as it moved on is mostly —
and usefully — wrong, because **every relevant uniqueness constraint spans
archived rows**. Archived records never released their identifiers, so nothing
could have taken them:

| Posited failure | Verdict | Why |
|---|---|---|
| Student number reused while archived | **Impossible** | `@@unique([schoolId, studentNumber])` covers archived rows — the number was never free, so creation of a duplicate was rejected at the time |
| Level order index now collides | **Impossible** | `@@unique([schoolId, orderIndex])` (and `[schoolId, name]`) cover inactive rows |
| Staff number / guardian primary phone collision | **Impossible** | Same — full uniques |
| Guardian's primary slot filled by someone else | **Cannot happen** | Archive leaves `student_guardians` rows (including `isPrimary`) untouched, so the archived guardian *still holds* the slot and `uq_one_primary_guardian_per_student` blocks a rival. Restore is lossless. The real quirk is the inverse — see below |
| Classroom whose academic year has since closed | **Not a failure — allow** | Restore is an `isActive` flip with no constraint involved. More importantly, blocking on `academicYear.isActive = false` would also block classrooms of *future* years (2026/2027 is `isActive = false` right now). Advisory only |
| Classroom whose **level** is archived | **Real — reject 409** | Level dropdowns list active levels only; a restored classroom would reference an invisible level. Message: "Restore the level '<name>' first." |
| Restoring a record that is not archived | **Real — reject 409** | "…is not archived." Keeps the endpoint idempotence explicit and auditable |
| Cross-school id | **Real — 404** | Existing tenant-check pattern on every module |

Flip-side finding worth stating: because uniques span archived rows, archived
records **permanently reserve** their numbers, names, order indexes, and phone
numbers. That is defensible (identifier reuse is a data-hygiene hazard) but it
is a policy the docs should state, and restoration makes it visible.

**The guardian quirk:** an archived guardian still occupying a student's
primary slot means the school cannot promote a replacement without unlinking
first. Recommendation for this phase: keep archive semantics as they are
(restore stays lossless), document the behaviour, and treat "set-primary may
displace an archived guardian's link" as a candidate follow-up — it needs the
partial index respected via a two-step swap in one transaction.

### Endpoint shape and a prerequisite

**Per-module `POST :id/restore`**, mirroring the existing per-module
`POST :id/archive` — not a shared generic endpoint. Permission: reuse each
module's existing archive permission for both directions (archive/restore are
one capability: lifecycle control). No new permission rows.

**Prerequisite:** `findAll` for **guardians** and **levels** currently filters
archived/inactive rows out unconditionally (`archivedAt: null`,
`isActive: true`) — archived guardians and levels are invisible to every
client, so restore would be unreachable. Add an `includeArchived` boolean
query param (default false) to those two list endpoints. Classrooms, staff,
and students lists already return archived rows. (Files also filters
`archivedAt: null`, which means the frontend's "Archived" column can never
show a date — pre-existing dead code, noted in §10.)

### Files: stay one-way — recommended

Files should keep archive-as-final: the records are metadata catalogue
entries, the Phase 1 UI and guide already promise "archiving is permanent",
re-creating a metadata record is four fields of typing, nothing references a
file record downstream, and — per the finding above — archived file records
are already invisible to the API, so restore would also demand list changes
for a module Phase 2 will rework wholesale (real upload/storage). Revisit
restoration when files become real binaries with real value.

---

## 5. Schema and migration plan

Changes, in order:

1. **Enum:** `AdmissionStatus` gains `withdrawn` → normal Prisma migration
   emitting `ALTER TYPE admission_status ADD VALUE 'withdrawn'`. Additive and
   safe; **irreversible** (Postgres cannot remove enum values).
2. **Unique:** `@@unique([schoolId, admissionNumber])` on
   `AdmissionApplication` → normal unique index in the same migration.
3. **Data backfill:** script assigning ADM numbers to null rows (see §2), run
   once after the migration; not schema DDL.
4. **No new columns.** Item 2 uses existing fields; item 3's fixed-restore
   decision means no `previousStatus` column.
5. **DTO-level (no migration):** `status` removed from `UpdateAdmissionDto`;
   `studentNumber`/`staffNumber` become `@IsOptional` on their create DTOs;
   `includeArchived` added to guardians/levels query DTOs.

**The four raw-SQL partial indexes survive untouched.** None of these
migrations creates, drops, or recreates `enrollments`, `academic_years`,
`terms`, or `student_guardians` — the only touched table is
`admission_applications` (one new index) plus the enum type. Per the standing
rule in `sms-pre/README.md`, `npm run db:raw-sql` still runs after
`prisma migrate` as a belt-and-braces step; it is idempotent-safe here because
nothing it targets is affected. The `revert-enrollment` guard *relies on*
`uq_one_active_enrollment_per_student_year` remaining in force, so the
migration checklist for this work should end with verifying all four indexes
exist (`\di` spot-check or the README's table).

Also updated in the same change: `prisma/seed-demo.ts` (admission numbers on
all six records, one `withdrawn` example admission so the badge and filter
have data, sequence `current_number` values).

---

## 6. New and changed API endpoints

All under the existing `/api/v1` prefix; no existing route path changes.

| Method + path | Body | Success | Failures |
|---|---|---|---|
| `POST /admissions/:id/apply` *(new)* | — | 200 admission | 404; 409 if status ≠ `enquiry` |
| `POST /admissions/:id/offer` *(existing, extended)* | `{ notes? }` | 200 admission | as today; now also records `approvedBy`/`approvedAt` |
| `POST /admissions/:id/revert-offer` *(new)* | `{ notes? }` | 200 admission | 404; 409 if status ≠ `offered` |
| `POST /admissions/:id/reject` *(new)* | `{ notes? }` | 200 admission | 404; 409 unless status ∈ enquiry/application/offered |
| `POST /admissions/:id/withdraw` *(new)* | `{ notes? }` | 200 admission | 404; 409 unless status ∈ enquiry/application/offered |
| `POST /admissions/:id/enroll` *(existing)* | unchanged | unchanged | unchanged |
| `POST /admissions/:id/revert-enrollment` *(new)* | — | 200 admission | 404; 409 if status ≠ `enrolled`; **409 "Withdraw the enrollment first." while an active linked enrollment exists** |
| `PATCH /admissions/:id` *(changed)* | `status` **removed**; `admissionNumber` editable as today | 200 | **409 with field-level message on admission-number collision** |
| `POST /admissions` *(changed behaviour)* | unchanged shape | 201 with `admissionNumber` populated | 500-class sequence failure → bounded retry then 409 |
| `POST /students`, `POST /staff` *(changed)* | `studentNumber`/`staffNumber` now optional | 201, number auto-filled if blank | as today |
| `POST /levels/:id/restore`, `/classrooms/:id/restore`, `/staff/:id/restore`, `/students/:id/restore`, `/guardians/:id/restore` *(new)* | — | 200 restored record | 404; 409 "not archived"; classrooms: 409 "Restore the level '<name>' first." |
| `GET /guardians?includeArchived=true`, `GET /levels?includeArchived=true` *(changed)* | query param, default false | archived rows included | — |

Response envelope, error filter, and audit behaviour: existing patterns, no
changes.

---

## 7. Frontend changes required, page by page

- **/admissions** — Admission # column loses its dash case for new records.
  Row actions become state-driven: `enquiry` → Apply/Offer/Reject/Withdraw/Edit;
  `application` → Offer/Reject/Withdraw/Edit; `offered` → Enroll/Revert
  Offer/Reject/Withdraw/Edit; `enrolled` → Revert Enrollment (enabled only
  when the API allows; the 409 message surfaces via the existing toast
  pipeline); terminal rows → no actions, dimmed. Status filter regains
  `withdrawn` — the exact value removed as phantom in the last pass, now
  legitimately backed by the enum. `AdmissionStatus` type += `'withdrawn'`;
  badge maps gain the entry.
- **/enrollments** — no changes (withdrawal already exists and is the
  precondition for revert-enrollment).
- **/students, /staff** — New-dialog number fields become optional with
  "Leave blank to auto-generate" placeholder; blank submission shows the
  returned number in the success flow.
- **/levels, /guardians** — "Show archived" toggle driving `includeArchived`;
  archived rows render dimmed with a Restore action.
- **/classrooms, /staff (list), /students (list)** — Restore action on
  already-visible archived/inactive rows.
- **/files** — no changes (stays one-way).
- **Shared** — no new components needed; `StatusBadge`, `useApiMutation`,
  `applyFieldErrors` cover everything. No route changes.

---

## 8. Documentation changes forced

- **BRITE_SMS_PHASE_1_USER_GUIDE.md §19 (Admissions):** pipeline becomes
  "**Enquiry → Application → Offered → Enrolled** (or Rejected / Withdrawn at
  any pre-enrolled stage)" — `application` is currently omitted entirely while
  being a real, row-returning status. Stage table gains Application and
  Withdrawn rows. "Admission number — manually assigned" section rewritten:
  auto-assigned at creation, editable, unique. "Reversing an offer — not
  available in Phase 1" section **replaced** with the revert-offer /
  revert-enrollment rules including the withdraw-first guard.
- **§16/§15 (Students/Staff):** number fields "leave blank to auto-generate".
- **§13/§17 (Levels/Guardians):** archive is no longer permanent; "Show
  archived" + Restore documented. **§16 Students / §14 Classrooms:** same.
- **§21 (Files):** "permanent" wording stays — now as a deliberate contrast.
- **Stakeholder testing guide:** admissions scenarios rewritten around the
  full pipeline (apply, reject, withdraw, both reversals, the enrolled-guard
  409 message as an expected outcome); restore scenarios added per module; the
  New Student/Staff blank-number path added; the §7.15 one-active note
  unchanged.
- **Completion reports:** no rewrites of history — a short "Phase 1B addenda"
  section in each listing the new capabilities, so the sign-off record and
  current behaviour stop diverging.
- **PDF regeneration:** user guide PDF rebuilt via the existing
  `qa/capture-guide-screenshots.mjs` → `qa/build-user-guide-pdf.mjs` pipeline
  after implementation (new dialogs and buttons appear in ~6 existing shots;
  add shots for Revert Offer and Restore).
- **sms-pre/README.md:** migration-checklist line: after this migration,
  verify the four partial indexes (unchanged but re-affirmed).

---

## 9. QA checks to add

To `qa/qa-pass.mjs` (current count 65):

1. Admission created → `ADM-\d{4}` present immediately in the row (no dash).
2. Two concurrent admission creations (parallel contexts) → distinct numbers.
3. Manual admission-number edit colliding → 409 with the specific message,
   field-level error on the input.
4. Each legal transition drives the row's badge to the expected state
   (apply, offer, revert-offer, reject, withdraw, enroll, revert-enrollment).
5. Each **illegal** transition (e.g. reject on an enrolled row via direct API
   call) → 409 with a specific message, never "Validation failed".
6. `revert-enrollment` with a live enrollment → 409 "Withdraw the enrollment
   first."; after withdrawal → succeeds, admission back to `offered`,
   `enrolledAt` cleared, `studentId` **retained** (DB assertion).
7. PATCH with a `status` field → rejected (`property status should not
   exist`), proving the bypass is closed.
8. Status-filter audit (existing check) now must show `withdrawn` returning
   rows once the seed includes one — it will catch the enum/frontend drift
   automatically.
9. Per module (level, classroom, staff, student, guardian): archive → restore
   → row visible with the correct restored status/flags (DB assertion on
   status/isActive/archivedAt).
10. Restore on a non-archived record → 409 "not archived".
11. Classroom restore under an archived level → 409 naming the level;
    restore level → classroom restore succeeds.
12. Guardians/levels lists: `includeArchived` off by default (archived absent),
    on shows them dimmed.
13. Student/staff creation with blank number → auto-number appears; with
    explicit number → that number used.
14. Files: archived file has **no** restore control; archive remains final.

Backend jest: transition-matrix unit tests on the admissions service (every
cell of the table, legal and illegal), restore-state unit tests per module,
sequence-retry test for the P2002 path.

---

## 10. Risks, and pushback

**Straight disagreements / cautions, as requested:**

1. **"Forbidden outright" on enrolled-reversal is the one instinct I'd argue
   out of.** §3 makes the case: forbidden-outright leaves a permanent lie in
   the pipeline after any operator mistake, and the withdraw-first guard gets
   you the same safety with a recovery path. If you overrule, it ships your
   way — one guard clause simpler — but the failure mode is yours on record.
2. **The enum addition is irreversible.** Postgres cannot drop `withdrawn`
   once added. I still recommend it (the semantic case is strong), but it is
   the only decide-once item in this proposal — if there is any doubt about
   *withdrawn-as-status* versus e.g. a future generic "closed reason" model,
   resolve it before migration, not after.
3. **Do not extend forced auto-numbering to students/staff.** Item 1 asks me
   to recommend rather than assume — my recommendation is fill-if-blank only.
   Forcing it breaks historical-record entry, which is a real Phase 1 use
   case; admissions are the only system-native number.
4. **Assign-at-creation numbers every dead enquiry.** Accepted trade-off
   (uniqueness over density), but if the school's paper practice numbers only
   offers, stakeholders may query it. It is a display/reporting concern, not a
   data one.
5. **Restore-of-files is the thing to *not* build**, as invited: promised
   permanence in shipped UI copy, invisible-to-API archived rows, and a
   Phase 2 rework incoming. One-way stands.
6. **Pre-existing debt this work walks past (flagging, not fixing):**
   `StaffStatus.on_leave`/`resigned` are unreachable via any API;
   `approvedBy`/`approvedAt` were never written until now;
   the files list filters archived rows so the frontend's "Archived" column is
   dead code; enrollment creation does not check that the target classroom's
   academic year is active. Each is a one-line-ish fix but none is in scope
   here — say the word and they become a small follow-up item.
7. **Concurrency honesty:** the sequence design is safe for the stated scale.
   If Phase 2 ever brings bulk import, the per-row lock becomes a bottleneck
   by design — the correct future answer is allocating ranges, not weakening
   the lock. Noted so nobody "optimises" it into a race.

---

*End of proposal. No code, schema, DTO, or migration changes have been made.*
