# ADR-002: Email and password sessions

Status: **implemented** on `feature/full-product-foundation`. Company signup in ADR-003 replaced the first-Super-Admin command and `POST /auth/accounts`. The decisions below remain the record of this authentication slice. Current onboarding and company scope are in ADR-003.

**25 September 2026 — current product, not a rewrite of this slice.** The body below still describes what this authentication slice shipped (`POST /auth/accounts`, the setup command, view if `canHandle` or submitter). Those provisioning paths were replaced by ADR-003. Super Admin admin APIs and the workspace now exist. Super Admin still cannot claim, own, or handle. **Implemented:** Super Admin sees dashboard totals and a limited oversight table (ID, submitter name, title, employee department, destination department, status). `GET /requests/:id` and history are full detail for that Super Admin’s submissions only; unrelated same-company ids are **403**. The finished detail rule also includes eligible Super Admin approval-inbox requests. Approval state and staff self-claim of an opened request are implemented. See `docs/product-spec.md`.

The separate claimable-queue page remains planned in `docs/product-spec.md`. Password reset and deployment hosting remain unresolved. Super Admin admin screens now exist as a later pass; this slice’s “no admin screens” sentence is historical.

## Confirmed rules this slice satisfies

- People sign in with email and password. There is no public registration.
- Super Admin provisions accounts. A one-time setup command creates the first Super Admin.
- Each account has one role: Employee, Department Admin, or Super Admin. Handler eligibility stays a separate flag (`canHandle` today).
- A deactivated account cannot sign in or call authenticated routes. Existing requests and status history stay in place.

## Implemented technical choices

- Passwords are hashed with **Argon2id** through the `argon2` package (`argon2.hash` with `type: argon2.argon2id`). The earlier bcrypt proposal was not used. Argon2id is a current password-hashing choice with a maintained library, so this slice does not invent a hash. Unknown emails and accounts that cannot log in run a dummy Argon2 verify so those failures are not obviously faster than a real password check.
- Email is trimmed, lowercased, and checked with `validator.isEmail` (`allow_display_name: false`, `require_tld: true`), then stored at most 254 characters. Counting `@` characters is not the check. PostgreSQL enforces uniqueness on `Employee.email`. Login of an invalid address is still the generic **401** and still counts toward the rate limit. Provisioning an invalid address is **400**.
- The JWT is signed and verified with **HS256 only**. `jwt.verify` is called with `algorithms: ['HS256']`. Claims are `sub` (account id string), `jti` (session id), and a required `exp`. `JWT_SECRET` must be a trimmed string of at least 32 characters. There is no code fallback and no committed secret. The API throws during startup, before it listens, when the secret is missing, blank, or shorter than 32 characters. Jest and Playwright set a test-only value in the test process. `.env.example` leaves `JWT_SECRET` empty.
- Session ids and CSRF tokens are `crypto.randomBytes(32)` encoded as base64url. `/auth/*` responses set `Cache-Control: private, no-store`, including **401** responses, via middleware on the auth controller. Password hashes are not selected into request or history JSON, lookup rows, provisioning responses, or login/`/auth/me` bodies. Login loads the hash only to verify it.
- Absolute lifetime is 8 hours from session creation. Idle timeout is 30 minutes from `lastActivityAt`. Activity updates `lastActivityAt` only and does not move `absoluteExpiresAt`. If that timestamp update fails after the business change is already committed, the API still returns the successful business response. It logs the fixed line `Session activity was not recorded.` and does not log the database error. Revocation, idle expiry, absolute expiry, and an inactive account are still enforced on the next authenticated request. A lost stamp can make the session look idle sooner. It does not extend the absolute lifetime.
- **Activity** is a successful authenticated request route, `POST /ai/intake`, `GET /employees`, `GET /departments`, or `POST /auth/accounts`. Successful account provisioning counts as activity.
- **Not activity:** `GET /auth/me`, `POST /auth/logout`, and `POST /auth/login`. There is no background polling route. The UI does not poll product routes to stay signed in.
- Login failures use a fixed window that starts at the first failure and lasts 15 minutes. Further failures inside the window increment the same counters. The next failure after the window starts a new window. A successful login does not clear either counter. Unknown emails use the same normalized, trimmed, lowercased key as known emails and increment both the email and IP counters. Defaults are `LOGIN_MAX_FAILURES_PER_EMAIL=5` and `LOGIN_MAX_FAILURES_PER_IP=100`, read on each check. Each attempt is admitted before password verification. In-flight attempts count against those same email and IP limits, so a concurrent burst cannot pass the gate before earlier attempts finish. A credential failure converts its slot into a failure. A successful login, or an infrastructure error after admission, releases the slot and does not add a failure. Storage is an in-memory `Map` in the API process. It resets on restart and is not shared across processes. Each check deletes expired buckets that have no in-flight attempt. A store already at 10,000 buckets rejects a new key instead of growing. The IP is Express `req.ip`. `X-Forwarded-For` is ignored unless the process is started with `TRUST_PROXY=true` behind a proxy that overwrites that header.
- The first Super Admin command runs `pg_advisory_xact_lock(814202616)` inside the same transaction as the Super Admin count and the insert. It inserts only when that count is zero. An unknown department id throws and rolls the transaction back, so nothing is inserted. The lock id is a constant, not user input.
- `npm run auth:set-dev-password` runs only when `NODE_ENV` is exactly `development` and the database name in `DATABASE_URL` is exactly `operations_hub`. It refuses `operations_hub_test` and every other name. It is not part of `prisma/seed.ts`. It sets a password hash from `DEV_ACCOUNT_PASSWORD` and, when the employee has no email yet, an email argument. It refuses when a password hash already exists, and it refuses to replace an existing email. Tests never call it. Test fixtures write credentials only after checking that the database name is exactly `operations_hub_test`.

The cookie, CORS, Origin, CSRF, provisioning, and temporary `canHandle` rules below are the behavior this slice runs. Department authorization, claiming, approvals, admin screens, and password reset are not implemented.

The browser stores an `HttpOnly` cookie named `hub_session`. `Secure` is set when `NODE_ENV=production`. `SameSite=Lax`, `Path=/`, and `Max-Age` is 8 hours. There are no refresh tokens and no "Remember me".

The UI keeps one session generation. Logout, a protected-route **401**, and a newly applied account each end the previous generation, clear the CSRF token, and clear account-specific request, history, intake, form, and lookup state. A response that belongs to an older generation is ignored, including a late **200** that arrives after the next person has signed in without a page reload. Login leaves email and password optional at the DTO. An omitted credential reaches the service and is the same **401** as a wrong password. `null`, numbers, booleans, objects, and arrays are supplied non-strings and are **400** before implicit conversion can turn them into strings. Login strings are normalized in the service, not in the DTO.

### Endpoints

| Method | Path | Who | Result |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public, with a trusted `Origin` | Sets the session cookie. Body: `{ "email", "password" }`. |
| POST | `/auth/logout` | Session plus CSRF token | Revokes that session and clears the cookie. |
| GET | `/auth/me` | Session | Current account without the password hash: id, name, email, departmentId, role, canHandle, active, and the CSRF token. |
| POST | `/auth/accounts` | Active Super Admin plus CSRF token | Creates one account. No admin screen. Counts as session activity. |
| GET | `/health` | Public | `{ "ok": true }`. Playwright uses this because `/employees` now requires a session. |

Request routes, `POST /ai/intake`, `GET /employees`, and `GET /departments` require a session. There is no public registration route.

### Account provisioning endpoint

`POST /auth/accounts` is how a Super Admin adds accounts in this slice. It does not render an admin screen and does not sign the new person in.

Body:

- `email`: required string. The server trims it, lowercases it, checks it with `validator.isEmail`, and stores that normalized value. It must be at most 254 characters.
- `password`: required string, at least 12 characters. Stored only as a hash.
- `name`: required string, trimmed, 1–200 characters.
- `departmentId`: required integer of at least 1, and it must name an existing department.
- `role`: required, exactly one of `EMPLOYEE`, `DEPARTMENT_ADMIN`, `SUPER_ADMIN`.
- `canHandle`: required JSON boolean. This is handler eligibility, not a second role. The string `"false"` is rejected. Global implicit conversion must not turn that string into `true`.

Validation failures are **400** and create nothing. An unknown `departmentId` is **400**. A duplicate normalized email is **409** with a message that the email is already in use. The existing row is not changed.

An Employee or Department Admin receives **403**. A missing or invalid session receives **401**. A deactivated Super Admin cannot call it, because that account cannot authenticate. The new account is active and has no session until that person logs in.

### First Super Admin command

The command is the only way to create the first Super Admin. It takes email, password, name, and an **existing department id** from the operator at runtime. It validates the department and refuses when that id does not exist. It does not print the password and does not put a password in seed data.

Concurrent runs must not create two initial Super Admins. The command takes a PostgreSQL advisory lock, counts Super Admin rows inside that lock, and inserts only when the count is zero. The loser of the race finds the committed row and exits without inserting.

Later Super Admins are created only through `POST /auth/accounts`.

### Migration of existing employees

The migration adds nullable credential columns. It does not delete employees, rewrite ids, or change request or history foreign keys.

- `email` is nullable. Uniqueness is on the normalized email. Multiple rows may have no email. Two non-null emails cannot normalize to the same value.
- `passwordHash` is nullable. The migration does not invent a password.
- `role` is set to Employee for existing rows. `canHandle` is unchanged.
- `active` defaults to true for existing rows.

Chadi and John keep their ids. Their requests and history stay. Until an email and password hash are stored, they cannot log in. Login looks up the normalized email. A missing email, a missing password hash, a wrong password, an unknown email, and a deactivated account all return the same **401**: `Invalid email or password`.

### Cookie, CORS, Origin, and CSRF

CORS and Origin checks are different controls.

- **CORS** tells the browser which UI origin may read credentialed responses. The allowlist is explicit (`http://localhost:5173` in development). It is not `*`. Allowed request headers include `Content-Type` and `X-CSRF-Token`.
- **Origin validation** is a server check on `POST /auth/login`, before the password is checked. The server requires an `Origin` header that is on the same explicit allowlist. A missing `Origin` or an untrusted `Origin` is **403**, creates no session, and does not say whether the password was correct. A browser preflight passing CORS does not skip this check.

The session row stores the synchronizer token (`csrfToken`). Login and `GET /auth/me` return that token in the JSON body. State-changing requests, including logout and `POST /auth/accounts`, must send it in `X-CSRF-Token`. A missing or wrong token is **403** and does not change state. `POST /auth/login` has no session yet; its server-side Origin check is the control for that call.

How the UI and API are hosted in production, and whether `SameSite` must change for split sites, stays an open deployment decision.

### Session storage and expiry

`Session` row: id, `accountId`, `csrfToken`, createdAt, lastActivityAt, absoluteExpiresAt, revokedAt. On every protected request the server verifies the JWT, loads the session by `jti`, and requires `Session.accountId` to equal `JWT.sub`. A mismatch is **401**. It then checks revocation, idle expiry, absolute expiry, and that the account is active, and loads the current role and `canHandle` from the account row.

- **Absolute lifetime:** 8 hours from session creation. Activity does not extend it. The JWT `exp` matches that timestamp.
- **Idle timeout:** 30 minutes from `lastActivityAt`, enforced on the server.
- Activity and non-activity are defined above. `POST /auth/accounts` counts as activity. `GET /auth/me` does not.

Expired or idle sessions set `revokedAt` and respond **401**. An expired JWT is **401** even when the session row is still inside both limits and `revokedAt` is still null. Deactivating an account rejects its existing cookie with **401** and does not set `revokedAt`. Logout sets `revokedAt` and clears `hub_session`. Logout does not delete requests or history.

### Login rate limits

Limits are failures only. A shared office network uses one public IP for many people, so the IP limit is broad and the account limit is tight. Window, reset, unknown-email, storage, and proxy behavior are in the implemented choices above.

- Per normalized email: **5** failed logins per 15 minutes (`LOGIN_MAX_FAILURES_PER_EMAIL`).
- Per client IP: **100** failed logins per 15 minutes (`LOGIN_MAX_FAILURES_PER_IP`).

In-flight attempts consume the same budget until they settle. Either cap returns **429** with `Too many login attempts. Try again later.` and creates no session. A success does not reset the failure counters. Expired idle buckets are removed. At 10,000 tracked buckets, a new key is rejected until a later check can prune.

## Smallest end-to-end scope

1. Login form with email and password. No registration link.
2. Logout control.
3. `GET /auth/me`.
4. Session required on request, intake, and lookup routes.
5. One-time setup command for the first Super Admin, with a department id.
6. `POST /auth/accounts` for a signed-in Super Admin. No admin screens.

In scope after login: create, load, manual owner assignment, status transition, history, and advisory intake.

Out of scope: admin screens, self-claim, approval inbox, password reset, refresh tokens, and "Remember me".

## Migration from `X-Actor-Id`

Protected routes ignore `X-Actor-Id`. A forged header cannot change the account. `submittedBy` and `changedBy` must still match the authenticated account. Existing `submittedBy`, `currentOwnerId`, and `changedBy` values stay valid.

Development credential setup and test fixtures are separate:

- A development-only command may set an email and password on an existing employee. It runs only when `NODE_ENV` is exactly `development`, and only when `DATABASE_URL` names the database `operations_hub`. It refuses `operations_hub_test` and any other name. It is not part of `prisma/seed.ts`.
- Automated tests never call that command. They insert credentials only inside the test process, and only when the test database name is exactly `operations_hub_test`, which the existing test loader already requires.

No production default password is committed.

## Temporary authorization

Until claiming and approvals are built, request rules stay as they are: view if `canHandle` or the caller submitted the request; assign and transition only when `canHandle`; the owner cannot be the submitter; only the current owner may transition.

Role is stored and returned by `GET /auth/me`. Department Admin does not gain an approval inbox. Super Admin does not gain department, request-type, or company-details screens. The only new Super Admin power in this slice is `POST /auth/accounts` plus the setup command. A Super Admin without `canHandle` cannot assign or transition. Deactivation has no screen; tests change the active flag in the test database.

This section is the authentication-slice record. Current Super Admin workspace powers and limited request oversight are in `docs/product-spec.md` and in the 25 September 2026 note at the top of this ADR.

## Acceptance criteria

These are met by the tests recorded below.

### Positive

- A provisioned active account with email and password hash can sign in from a trusted Origin and receive an `HttpOnly` session cookie. `GET /auth/me` returns the role and `canHandle` loaded from the database, plus the CSRF token stored on the session.
- `Session.accountId` matches `JWT.sub` for that session.
- After login, the existing John/Chadi request journey and advisory intake still work. Intake still does not create a request.
- Logout revokes the session and clears the cookie. The next protected call is **401**.
- The setup command, given an existing department id, creates one Super Admin. A second process running at the same time does not create another.
- A Super Admin can `POST /auth/accounts` and the new person can later log in. Existing request and history rows stay attached to the same employee ids.
- An employee row left without email or password hash cannot log in, and its requests and history remain.

### Negative

- Wrong password, unknown email, missing credentials, and a deactivated account all get the same invalid-credentials **401**.
- Missing cookie, tampered JWT, wrong `alg`, `Session.accountId` different from `JWT.sub`, revoked session, idle expiry, absolute expiry, an expired JWT whose session row is still inside both limits, and a cookie presented after the account is deactivated are **401**.
- The API does not start when `JWT_SECRET` is missing or blank.
- Repeated `GET /auth/me` does not move `lastActivityAt` and does not prevent idle expiry.
- A forged `X-Actor-Id` does not switch account.
- A state-changing request without the session's CSRF token is **403** and does not change state.
- `POST /auth/login` with a missing Origin or an Origin outside the allowlist is **403** and creates no session, including when the password is correct.
- The per-account failure cap and the broader per-IP cap each return **429** and create no session. Concurrent in-flight attempts count toward those caps. Expired limiter buckets are deleted.
- Employee and Department Admin calls to `POST /auth/accounts` are **403**. Duplicate normalized email is **409** and does not change the existing account. Invalid body fields and an unknown department id are **400**.
- The setup command fails when the department id does not exist and inserts nothing.
- The development credential command refuses to run unless `NODE_ENV=development` and the database name is `operations_hub`. Tests that are not on `operations_hub_test` do not start.
- Changing `canHandle` or role in the database is visible on the next protected request without a new token.
- Deactivating the account makes the next protected request **401** and leaves history rows in place.

## Test plan

Backend tests keep using `operations_hub_test` and `MockAiProvider`. They must not call Requesty. Test fixtures create emails and password hashes in that database only. They do not call the development credential command.

- Login success and the identical **401** for wrong password, unknown email, missing credentials, and deactivation.
- Tampered token, disallowed `alg`, missing cookie, `accountId`/`sub` mismatch, idle expiry, absolute expiry.
- Startup refusal when `JWT_SECRET` is missing or blank.
- `GET /auth/me` does not refresh idle time; a product mutation does.
- Logout, then reuse of the cookie.
- Permission change in the database applies on the next request.
- Forged `X-Actor-Id` does not switch account.
- CSRF: missing and wrong token rejected; the token stored on the session accepted.
- Origin: missing Origin, untrusted Origin, and a trusted Origin. Confirm this still fails when CORS would have allowed a different browser check, so the tests call the server directly.
- Per-account lockout stays available to a different account on the same IP. The broader IP cap trips only after the higher IP threshold.
- Provisioning: Super Admin success; Employee and Department Admin **403**; duplicate normalized email **409** with the original row unchanged; invalid email, short password, and unknown department **400**.
- Setup command: valid department creates one Super Admin; unknown department creates none; two overlapping runs leave a single Super Admin.
- Migration preservation: on a scratch database that is not `operations_hub` or `operations_hub_test`, apply the pre-auth migrations, insert an employee, request, and history row, apply `20260922160000_add_authentication`, and read those rows back unchanged. The test calls `CREATE DATABASE` directly. It sets `createdByThisRun` only after that succeeds, and only then may it terminate connections and drop the database. If the name already exists, or creation fails for another reason, it does not terminate connections or drop it. Both scratch connections go through one helper. If `connect()` fails, that helper closes the allocated client and preserves the connection error. Drop still happens only when this run created the database. A schema query against `operations_hub_test` is not this proof. A separate behavior test still checks that an existing employee without credentials cannot log in.
- A failed `lastActivityAt` update after a successful create still returns **201**, and a later revoked session is still **401**.
- Playwright: user A loads private request data, a protected call returns **401**, user B signs in without a page reload, and A's title plus a late payload from A's request stay absent.
- Development command: refuses `operations_hub_test` and refuses a non-development `NODE_ENV`.
- Existing lifecycle, persistence, business-rule, HTTP, and intake eval assertions stay, using a cookie helper instead of `asActor`. Evals still prove intake writes no request or history.
- Playwright signs in through the form against `operations_hub_test` only. It no longer uses the Acting-as switcher.

## Verification commands

```powershell
npm test
npm run eval:ai
npm run build
cd frontend
npm run build
cd ..
npm run test:e2e
```

Record the actual results, or the blocker if a command cannot be run.

## Assumptions

- Argon2id through `argon2` is the hash for this slice. The earlier bcrypt proposal was dropped because the implementation decision required Argon2id and an established library.
- `SameSite=Lax` is enough while the UI and API are both on `localhost`. A split production host is a deployment decision, not part of this slice.
- `canHandle` keeps meaning handler eligibility during this slice. Replacing it here would mix a later authorization change with login.
- Existing rows become Employee with nullable credentials. They were not Super Admins, and inventing a password would put a default secret in the migration.
- Five failures per normalized email and 100 per IP per 15 minutes are the initial configurable limits. A low per-IP cap would lock out a shared office NAT. The counters are process-local until a shared store is needed.

## Still unresolved

- Password reset.
- Deployment: production origin allowlist, cookie `SameSite` if the UI and API are on different sites, and where the services are hosted.
- Release and reassignment, required submission fields, claiming, approvals, admin screens, and the other open items in `docs/product-spec.md`.
- The in-memory rate limiter is not shared across API processes.
- Deactivation still has no screen. Tests set `active` in `operations_hub_test` only. The development database was not migrated or given credentials by this work.
- If `operations_hub_auth_migration` is left behind by a crashed run, the preservation test fails and does not drop it. That database has to be removed outside the test.

## Verification on 22 September 2026

Commands were run on this machine after `npm run test:db:setup` had applied `20260922160000_add_authentication` to `operations_hub_test` only. This pass did not migrate the development database `operations_hub` and did not change its credentials. Migration preservation was checked on a scratch database, `operations_hub_auth_migration`, which is not `operations_hub` or `operations_hub_test`.

| Command | Result |
| --- | --- |
| `npm test` | 10 suites, 58 tests, all passed |
| `npm run eval:ai` | 8 evals, all passed. `MockAiProvider` only |
| `npm run build` | Nest build passed |
| `cd frontend; npm run build` | `tsc` and Vite build passed |
| `npm run test:e2e` | 6 Playwright tests passed (2 login, 3 intake, 1 request flow) |

A later pass the same day checked the migration-database guard and strict login credential types. It did not migrate `operations_hub` or change its credentials. `npx jest src/auth/auth.spec.ts src/auth/migration-preservation.spec.ts --testTimeout=60000` passed 2 suites and 22 tests. `npm run build` passed. The full Jest suite, AI evals, frontend build, and Playwright suite were not re-run in that pass.

A following pass closed a scratch client when its `connect()` failed. `npx jest src/auth/migration-preservation.spec.ts --testTimeout=60000` passed 1 suite and 6 tests. `npm run build` passed. It did not migrate `operations_hub` or change its credentials, and it did not re-run the auth spec, full Jest suite, AI evals, frontend build, or Playwright.

## Implementation sequence

Completed in this slice: additive migration, first-Super-Admin command, login, logout, `/auth/me`, provisioning, cookie, CSRF, Origin checks, CORS credentials, rate limits, protected routes, login form, and the development credential command kept separate from test fixtures.
