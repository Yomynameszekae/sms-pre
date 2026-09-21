# Roles, Permissions and User Accounts — Admin Guide

*Working doc, started 2026-09-21. Captures how access control actually works in Brite SMS, confirmed against the real code and (where noted) the deployed database — not guessed. A copy of this also lives in the codebase (see note at bottom).*

## The short version

There are **three separate concepts** that look related but aren't the same thing. Confusing them is the most common way to misdiagnose an access problem:

| Concept | What it is | Where you manage it |
|---|---|---|
| **Staff record** | An HR/organizational record — name, contact, employment type, NTC status. Can exist with or without system access. | Staff screen (People → Staff) |
| **Staff "Role" field** (Teacher / Admin / Support) | A simple category label on the Staff record. Cosmetic/organizational only. | Edit Staff Member modal |
| **User Account (login)** | Credentials that let someone sign in. Optionally linked to a Staff record, but a Staff record does not require a linked login, and creating one does not create the other. | User Accounts screen (School Setup → User Accounts) |
| **RBAC Role** (SUPER_ADMIN, SCHOOL_ADMIN, HEADTEACHER, BURSAR, CLASS_TEACHER, ACADEMIC_COORDINATOR, ADMISSIONS_OFFICER, COMPLIANCE_OFFICER, PARENT_GUARDIAN) | The actual security role that determines what a logged-in account can do. A User can hold multiple RBAC roles (many-to-many); permissions are the union of all roles held. | Roles & Permissions screen (grants what a role can do) + User Accounts screen (assigns which role(s) a user has) |

**Confirmed in code**: the Staff "Role" category field is used *only* inside the staff module (create/update/filter/display). It is never read by any auth guard, and nothing in staff.service.ts touches the `user_roles` table. Setting a Staff record's category to "Admin" grants zero access. The actual access chain is:

```
User → user_roles → roles → role_permissions → permissions → JWT claim → PermissionsGuard
```

## The Staff ↔ User link, precisely

- A `User` **must** name a linked entity (`linkedEntityType` + `linkedEntityId` are both `NOT NULL`) — you cannot create a floating login.
- A `Staff` row **may have zero** `User`s pointing at it. This direction is genuinely optional.
- There is **no foreign key** between them — it's a polymorphic soft reference (type + id, indexed but not constrained). `Staff` has no back-relation. This means nothing stops a `User` being created with a `linkedEntityId` that doesn't actually exist; the create path writes it straight through with no lookup. Not something that's caused a problem yet, but worth knowing.
- A raw-SQL unique index (`uq_users_school_linked_entity`) enforces **at most one login per staff member** per school.
- Neither creation path is linked automatically: creating a Staff record never creates a User, and creating a User never creates a Staff record.
- **There is a half-built invite mechanism**: an `account_setup` token type exists and `POST /auth/account-setup/confirm` is fully implemented — but nothing anywhere in the codebase currently *issues* one of these tokens. The "redeem an invite" half exists; the "send an invite" half does not. Don't assume invites work — they don't yet.

**In your seeded local database, 10 of 11 staff have no login.** That's the expected shape of the data, not a bug — most staff simply aren't given system access.

## How to provision a login for an existing staff member (current state, 2026-09-21)

**There is no portal/UI path for this at all — not even for an unlinked account.** The backend supports it; the frontend has nothing:

- `POST /api/v1/users` (requires `users.create` permission) already accepts a request that creates a User pre-linked to an existing Staff row:
  ```json
  {
    "email": "person@school.edu.gh",
    "phone": "233...",
    "password": "<min 8 chars, temporary>",
    "linkedEntityType": "staff",
    "linkedEntityId": "<the staff record's id>"
  }
  ```
  This sets `mustChangePassword: true`, so the admin picks a temporary password and the person is forced to change it at first sign-in.
- The **current workaround**: call this endpoint directly (curl/Postman) with an admin bearer token, then open **User Accounts** and tick a role for the new login — an account with zero roles can sign in but gets refused everywhere, which looks like a broken product rather than what it is.
- **This is a known gap, not yet built**: a proper "Create login" action from the Staff screen. Estimated effort (not yet started):
  - *Simple version* (admin sets a temporary password, same as the API today): roughly half a day — a UI dialog + wiring, no backend changes needed.
  - *Proper version* (SMS-based invite, no human ever handles a password): 2–3 days — requires building the token-issuing side of the account_setup flow above, wiring the already-reserved `account_setup` notification trigger/template, and a public setup page on the frontend.

## Roles & Permissions — how grants work

- Permissions are defined in a single catalogue (`prisma/permissions.catalog.ts`), shared by both the seed script and a standalone sync script, specifically so the two can't drift apart.
- Each role has a *default* set of permissions it's meant to hold (e.g. `SUPER_ADMIN` and `SCHOOL_ADMIN` get everything; `HEADTEACHER` gets a read-only subset; `BURSAR` gets fee/invoice/notification permissions).
- A permission you deliberately revoke from a role stays revoked — the sync tooling only ever *inserts* missing rows, it never deletes or overwrites an existing grant.
- Changes to role permissions take effect **at next sign-in** — permissions are baked into the access token (JWT), so an already-logged-in session keeps the old set until the user logs out and back in.

## The permissions-sync gotcha (important for every future phase)

`prisma migrate deploy` applies schema changes only — it does **not** re-run seed data. Every time a new phase adds new permissions (e.g. Fees & Billing added `fee_types.*`, `school_fees.*`, `invoices.*`, etc.), those new permission rows and their default role-grants will **not** exist on an already-migrated production database until someone explicitly runs the sync.

**Standard post-deploy step, going forward:**
```
docker exec <sms-pre container name> npm run permissions:check   # read-only dry run
docker exec <sms-pre container name> npm run permissions:sync    # applies missing rows/grants
```
Run `permissions:check` after every backend deploy that could plausibly have added new permissions. If it reports anything missing, run `permissions:sync`, then have affected users sign out and back in.

(First time this bit us: 2026-09-21, deployed database was missing 28 permissions and an entire role, `BURSAR`, because the seed had never been re-run after Phase 2 shipped. Fixed via the sync script above.)

## Checking whether a specific staff member has a login

```
docker exec -it <sms-pre container name> npm run staff:login-check -- "Full Name or email or staff id"
docker exec -it <sms-pre container name> npm run staff:login-check -- --unlinked   # lists every staff member with no login
```
Read-only, no writes. Same devDependency caveat as `permissions:check`/`:sync` — runs via `ts-node`, which may not be present if the production image was built with `--omit=dev`. If `docker exec` into the running container doesn't work, the fallback is running it from a local checkout with `DATABASE_URL` pointed at production (safe, since it's read-only) — though note production's Postgres isn't exposed to the host, so this needs an SSH tunnel from outside the server.

## Screens

- **Roles & Permissions** (`/roles`, School Setup sidebar): what each role can do. Checkbox grid, 94 permissions grouped into ~28 modules, per role.
- **User Accounts** (`/users`, School Setup sidebar, above Roles & Permissions): which role(s) each login holds. Checkbox grid, accounts × roles. Flags accounts with zero roles. Filters out deactivated/retired accounts by default.

---
*This is the canonical copy. A duplicate is also kept in the project's Claude docs for cross-tool visibility — if you're editing this, that copy should be updated too (not something you need to do yourself, just flagging why a duplicate exists).*
