# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized staff can view and handle those requests.

## Current Stage

The current slice is the Week 4 React + NestJS + PostgreSQL app, advisory Request Intake, email/password sessions, company signup, the company Super Admin workspace, company-scoped request types with a captured approval-policy snapshot, and optional department templates.

An employee signs in with email and password, then describes a need in free text. The API analyzes it with Requesty at runtime (`AI_PROVIDER=requesty`) and returns troubleshooting and/or a draft. Intake never creates a request; the employee reviews the draft and submits through Create Request. Automated tests and evals use `MockAiProvider`.

A company Super Admin lands on a sidebar workspace: Dashboard, Employees, Departments, and Requests work for that company. Requests is a filterable company-wide oversight list (All requests and My requests) with ID, submitter, title, employee department, destination department, and status. Create Request and Request Intake stay as actions. Super Admin may submit and may open details/history for requests they submitted. Unrelated rows do not open description or history. They cannot assign, claim, or change work status. Approvals and Settings are marked Coming later and have no invented data or working controls. Employee and Department Admin accounts do not get those pages by changing the URL or calling the Super Admin APIs.

This is not the full application. Approvals, claiming, Settings, and top-handler ranking are not implemented. Unassigned on the Super Admin list is not claimable. Manual assignment is a temporary path for eligible non-Super-Admin handlers. A company Super Admin can add, rename, or delete unused departments, review optional department templates, manage request types and each type’s approval policy, and invite staff from the workspace. New signup companies start with ordinary IT, HR, and Finance departments and no request types; those department names are not locked. Existing companies are not backfilled. Confirmed plans for the later work are in [Planned full product](#planned-full-product-not-implemented).

Stack:

```
React/Vite UI (localhost:5173)
  → NestJS API (localhost:3000)
    → Prisma
      → PostgreSQL
```

Identity is an `HttpOnly` cookie named `hub_session`. The UI has Log in, Log out, and Create a company workspace. There is no public employee signup. Protected calls send `X-CSRF-Token`. `X-Actor-Id` is ignored. Each account belongs to one company, and the API will not return another company’s data.

Lifecycle for this slice: `SUBMITTED → IN_PROGRESS → COMPLETED`. `COMPLETED` is terminal. A current owner is required before a transition. Assign and transition require `canHandle` and a non-Super-Admin actor. A Super Admin cannot become current owner.

Seeded people: Chadi (`id=1`, IT, `canHandle=true`), John (`id=2`, IT, `canHandle=false`). Department `1` is IT. The company migration attaches existing rows to one Development company and does not invent a password. After that migration their emails and password hashes are still empty, so they cannot log in until credentials are set with the development command below.

## Planned full product (not implemented)

`docs/product-spec.md` is the source for confirmed future requirements. Login, revocable sessions, company signup, company-scoped invitations, one role per account, separate handler eligibility, and the Super Admin workspace are implemented and described in `docs/decisions/ADR-002-authentication.md` and `docs/decisions/ADR-003-company-signup.md`. Request visibility for Employee and Department Admin is still the temporary `canHandle` or submitter rule, limited to the caller’s company.

**Implemented today:** a company Super Admin can list every request in their own company on a limited oversight table (ID, submitter name, title, employee department, destination department, status). They may submit and may open details/history for their own submissions. Unrelated same-company `GET /requests/:id` and history are **403**; another company is **404**. They cannot claim, own, assign, or change work status, including through the temporary assignment endpoint. Dashboard request-count cards open the matching filtered Requests list. New companies start with ordinary IT, HR, and Finance departments. Super Admin may rename them or delete unused ones (**409** while employees or requests exist). Super Admin creates, renames, and edits request types per destination department (`NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`). New requests require a valid type and store a snapshot of that policy. Later type edits do not change submitted requests. Existing companies are not backfilled. Optional templates are IT, HR, Finance, Operations, Marketing, Facilities, and Custom/Empty. Display name is independent of the template. Super Admin reviews suggested types and policies, may edit or remove them, and applies only the confirmed list. Custom/Empty suggests none. The catalog in `docs/product-spec.md` is a recommendation, not company policy. Signup does not apply types. Duplicate type names in a department return **409**.

**Confirmed (planned):** Super Admin full detail also covers requests they are eligible to decide in the Super Admin approval inbox, when that inbox exists. Do not restore company-wide body access. Each department request type uses `NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`, captured on submit; type CRUD, that snapshot, and template review are implemented, and approval decisions are not. AI never sets that policy. Approval state, inbox, and decisions ship before staff self-claim. People see their own submissions under the full visibility rules; the claimable queue is eligible unassigned requests in their department, and Assigned to me is the separate list of requests they personally own; colleagues' assigned requests appear on neither list; eligible non-Super-Admin people claim from the claimable queue, only in their department, never their own submissions, and concurrent claims leave one owner; administrators do not assign work by hand. A request whose captured policy is not `NONE` becomes claimable only after approval. Denial keeps the work status, sets approval state to Denied, and never unlocks claiming. Resubmission creates a new request. The submitter cannot approve their own request; self-approval is never an implicit fallback. What happens when the only Super Admin submits a `SUPER_ADMIN` request is unresolved. Deactivation immediately blocks login and new claims, and is rejected while the account owns unfinished work. Login already rejects a deactivated account. The unfinished-work check and claim blocking are not implemented. Work status stays `SUBMITTED → IN_PROGRESS → COMPLETED`.

Release and reassignment, password reset, production email delivery, and deployment hosting are still open. Do not treat them as decided.

## Development workflow

Each feature follows this sequence:

1. **Define.** Write the requirement, acceptance criteria, and any unresolved decisions in the product docs before coding.
2. **Plan.** Name the smallest change to the current system, what the backend still owns, and which tests will prove it.
3. **Implement.** Change only what that plan covers.
4. **Prove.** Add automated tests for the success path, failure cases, and permission denials. Run the relevant tests and regression checks, the production build and type checks, and the AI evals when the change touches intake. Record the actual results, or the blocker if a check could not be run.
5. **Review.** Update the docs that describe current behavior, include those recorded results, and check the outcome against the acceptance criteria.

Weekly notes under `docs/week2-*`, `docs/week3-*`, and `docs/week4-*` stay records of those deliveries.

## Install

Requires Node.js 18 or later, a local PostgreSQL server, and (for the browser test) Google Chrome.

```powershell
npm install
cd frontend
npm install
cd ..
```

## Development database

Create a database named `operations_hub`. Copy `.env.example` to `.env` and set `DATABASE_URL` and a generated `JWT_SECRET`. Do not commit the secret.

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/operations_hub"
JWT_SECRET=
AUTH_ORIGINS=http://localhost:5173
AI_PROVIDER=requesty
REQUESTY_MODEL=mistral/leanstral-1-5
REQUESTY_API_KEY=
```

Generate the secret in a shell and put it only in `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

If the password contains `#`, `@`, or `%`, URL-encode those characters (`#` → `%23`).

`REQUESTY_API_KEY` is used only by the NestJS API. Do not put it in frontend env files. Automated tests ignore Requesty and force `AI_PROVIDER=mock`. They also set their own test-only `JWT_SECRET`.

The intake client waits 90 seconds and does not retry a timeout. A **503** whose log says `httpStatus=none` means Requesty did not finish; that is not an invalid JSON result. A **502** means a finished response failed intake validation. The default model is `mistral/leanstral-1-5`, the free Requesty model that supports JSON schema. Requests omit `temperature` because this model rejects greedy sampling (`temperature: 0`) with HTTP 400. Eight repeated intake calls on 25 Sep 2026 all returned HTTP 200 and valid intake JSON in 1.1–4.0 seconds. `gemma-4-31b-it` does not support JSON schema and can sit for the full 90 seconds with no HTTP status; paid schema models returned HTTP 402 because the organization balance is too low. The 90-second ceiling is unchanged.

Apply migrations on `operations_hub`. This does not reset the database. Nest does not seed on start, and seed does not set passwords.

```powershell
npx prisma migrate deploy
npx prisma db seed
```

Create a company from the sign-in page: company name, your name, email, and a password of at least 12 characters. Verify the email before the workspace is active. Signup creates IT, HR, and Finance for that company. On the development database, with `NODE_ENV=development`, the API logs that verification link. It does not log it for tests or production, and the signup response does not include the token. Production has no mail provider, so signup and invitations fail there and create no records. That is not production onboarding.

`npm run auth:create-super-admin` no longer creates an account.

To let an existing employee such as John sign in on the development database, pass an email only when that row does not have one yet. The command refuses to replace an existing email or password hash. It runs only when `NODE_ENV` is `development` and `DATABASE_URL` names `operations_hub`.

```powershell
$env:NODE_ENV="development"
$env:DEV_ACCOUNT_PASSWORD="choose-a-password-at-least-12"
npm run auth:set-dev-password -- 2 john@example.com
```

## Start the API

```powershell
npm start
```

The API listens on `http://localhost:3000`.

## Start the UI

In a second terminal:

```powershell
cd frontend
npm run dev
```

The UI listens on `http://localhost:5173`.

## Request Intake

1. Open `http://localhost:5173` and log in.
2. In **Request Intake**, describe what you need and click **Analyze**. Nothing is submitted.
3. A **problem** shows up to 3 troubleshooting steps first. Required missing details keep **Prepare a request** hidden until a later analysis has none. A **need** with no required gaps skips troubleshooting and offers to prepare a request.
4. Optional **suggestions** may appear with a draft; they do not block **Prepare a request**.
5. After yes, edit department, request type, title, and description, then click **Create Request** (existing `POST /requests`). Intake may suggest a type from this company’s types. It cannot choose or override approval policy.

Thin input such as “I need help.” stays on the form with no draft.

## Exercise the flow

1. Open `http://localhost:5173`.
2. Log in as **John**.
3. Create a request to **IT** with request type **General** (title and description are optional). Note the request ID. Status is **SUBMITTED**.
4. Log out, then log in as **Chadi**. The loaded request clears.
5. Enter the ID under **Request ID** and click **Load Request**.
6. Assign **Chadi** as owner.
7. Click **Start Request**. Status becomes **IN PROGRESS**. History shows `SUBMITTED → IN PROGRESS` by Chadi.
8. Optionally click **Complete Request**.

The UI only exposes the next legal transition. Invalid skips such as `SUBMITTED → COMPLETED` are rejected by the API with **409**.

John can view his own request. John cannot view Chadi's request (**403**). Chadi can view John's request.

## Endpoints

Request routes, `POST /ai/intake`, `GET /employees`, `GET /departments`, `GET /request-types`, `GET /department-templates`, `PATCH /departments/:id`, `DELETE /departments/:id`, `GET /admin/dashboard`, `GET /admin/employees`, and `GET /admin/requests` require a session cookie. State-changing calls also require `X-CSRF-Token`. `GET /health` is public.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Body: `{ "email", "password" }`. Requires a trusted `Origin`. Sets `hub_session`. |
| POST | `/auth/logout` | Revokes the session and clears the cookie. Requires `X-CSRF-Token`. |
| GET | `/auth/me` | Current account, company, and CSRF token. Does not extend the idle timer. |
| POST | `/auth/signup` | Public, with a trusted `Origin`. Body: `{ "companyName", "name", "email", "password" }`. Creates a pending company, ordinary IT, HR, and Finance departments, and an inactive Super Admin. Does not return a token or set a session. |
| POST | `/auth/verify-email` | Public, with a trusted `Origin`. Body: `{ "token" }`. Activates that company and Super Admin. |
| POST | `/auth/invitations` | Company Super Admin only. Body has email, name, departmentId, role, and canHandle. Does not accept a password. |
| POST | `/auth/invitations/accept` | Public, with a trusted `Origin`. Body: `{ "token", "password" }`. The invitee sets the password. |
| POST | `/departments` | Company Super Admin only. Body: `{ "name" }` plus optional `templateId` (`IT`, `HR`, `FINANCE`, `OPERATIONS`, `MARKETING`, `FACILITIES`, `CUSTOM_EMPTY`) and confirmed `requestTypes` (`name`, `approvalPolicy`). The name is independent of the template. Only the confirmed types are created, in one transaction with the department. Custom/Empty creates none. Duplicate type names return **409**. |
| PATCH | `/departments/:id` | Company Super Admin only. Body: `{ "name" }`. Renames a department in the caller’s company. |
| DELETE | `/departments/:id` | Company Super Admin only. Deletes an unused department in the caller’s company. **409** if employees or requests still use it. Unused request types for that department are removed with it. |
| GET | `/department-templates` | Company Super Admin only. Catalog of IT, HR, Finance, Operations, Marketing, Facilities, and Custom/Empty, including recommended suggestions. |
| GET | `/department-templates/:id` | Company Super Admin only. Preview one template. Unknown id is **404**. Suggested types are recommendations until Super Admin confirms them. |
| POST | `/departments/:departmentId/template-types` | Company Super Admin only. Apply confirmed `requestTypes` from a selected template to an existing department. Existing types and submitted requests stay. Duplicate names return **409**. |
| GET | `/request-types` | Request types for the caller’s company: id, departmentId, name, approvalPolicy. |
| POST | `/departments/:departmentId/request-types` | Company Super Admin only. Body: `{ "name", "approvalPolicy" }` where policy is `NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`. Duplicate names in that department return **409**. |
| PATCH | `/request-types/:id` | Company Super Admin only. Body may include `name` and/or `approvalPolicy`. Does not rewrite submitted requests. |
| GET | `/health` | `{ "ok": true }`. |
| POST | `/requests` | Create. Always `SUBMITTED`. Body: `{ "submittedBy": 2, "departmentId": 1, "requestTypeId": 1 }` plus optional `title` and `description`. `submittedBy` must match the signed-in account. `requestTypeId` must belong to that department in the caller’s company. The live type policy is stored as `capturedApprovalPolicy`; the client cannot supply the snapshot. |
| GET | `/requests/:id` | Fetch a request the account may view. A Super Admin may fetch full detail only for requests they submitted. Unrelated same-company ids are **403**. Another company is **404**. |
| PATCH | `/requests/:id/owner` | Temporary assign owner. Body: `{ "currentOwnerId": 1 }`. Actor must have `canHandle` and must not be Super Admin. Owner must have `canHandle`, must not be the submitter, and must not be Super Admin. |
| PATCH | `/requests/:id/transition` | Body: `{ "to": "IN_PROGRESS", "changedBy": 1 }`. `changedBy` must match the signed-in account and the current owner. |
| GET | `/requests/:id/history` | Successful status history the account may view. Same Super Admin rule as `GET /requests/:id`. |
| POST | `/ai/intake` | Advisory analyze. Body: `{ "text": "I need a laptop." }`. Does not create a request. |
| GET | `/employees` | Employees for the request UI: id, name, departmentId, canHandle. |
| GET | `/departments` | Departments for the UI. |
| GET | `/admin/dashboard` | Company Super Admin only. Counts for employees, departments, all requests, SUBMITTED, IN_PROGRESS, COMPLETED, and active requests (`SUBMITTED + IN_PROGRESS`) in the caller’s company. |
| GET | `/admin/employees` | Company Super Admin only. Name, email, department, role, canHandle, and active for that company. Optional combinable query: `q`, `departmentId`, `role`, `canHandle`, `active`. Never returns password hashes, tokens, or sessions. |
| GET | `/admin/requests` | Company Super Admin only. Paginated limited oversight list: id, submitter name, title, submitter department, destination department, status, and `mine`. Query: `scope` (`all` or `mine`; mine is submitted by the Super Admin), `departmentId`, `status` (`SUBMITTED`, `IN_PROGRESS`, `COMPLETED`, or `ACTIVE` = SUBMITTED + IN_PROGRESS), `assignment` (`all`, `unassigned`, `assigned`), `q` (title, submitter name, department names, id — not description), `page`, `pageSize` (default 20, max 50). Ordered by `statusUpdatedAt` desc, then id desc. Unassigned is not claimable. |

Visibility inside the caller’s company: Employee and Department Admin still use `canView = actor.canHandle || request.submittedBy === actor.id`. A company Super Admin lists the limited oversight table without `canHandle`. Full `GET /requests/:id` and history for Super Admin are own submissions only (**403** otherwise in the same company). They cannot become current owner and cannot assign or transition. A request, employee, or department from another company is treated as missing. Handler actions require `canHandle` and a non-Super-Admin actor. Super Admin dashboard, employee-list, and request-list routes require the Super Admin role in that company; other roles receive **403**. Unauthorized in the same company → **403**. Illegal lifecycle edge by an authorized handler → **409**, no history write. Missing request → **404**.

Responses include nested `submitter`, `department`, `requestType`, `capturedApprovalPolicy`, and `currentOwner`. Legacy requests may have a null type and snapshot.

## Tests

Automated tests use a **separate** database, `operations_hub_test`. They will not run against `operations_hub`.

Create `operations_hub_test` once in PostgreSQL. Copy `.env.test.example` to `.env.test`:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/operations_hub_test"
AI_PROVIDER=mock
```

Prepare schema and seed on the test database only:

```powershell
npm run test:db:setup
```

Backend (Jest):

```powershell
npm test
```

AI intake evals (8 cases; also included in `npm test`):

```powershell
npm run eval:ai
```

Backend production build (Nest → `dist/`, entry `dist/main.js`). Does not call Requesty:

```powershell
npm run build
```

Browser E2E (Playwright: login, company signup, request-flow, intake, Super Admin workspace and company request list). Google Chrome must be installed. Playwright uses `channel: 'chrome'`, not bundled Chromium. Stop anything already listening on ports 3000 or 5173. The API process is started with a test-only `JWT_SECRET` and `operations_hub_test`.

```powershell
npm run test:e2e
```

`npm test` and `npm run test:e2e` refuse to start unless `.env.test` points at the exact database name `operations_hub_test`.

Checked on 22 September 2026. `npm run test:db:setup` had already applied `20260922160000_add_authentication` to `operations_hub_test` only. This pass did not migrate `operations_hub` and did not change its credentials. `npm test` passed 10 suites and 58 tests, `npm run eval:ai` passed 8 evals, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 6 tests. A later pass the same day re-ran `npx jest src/auth/auth.spec.ts src/auth/migration-preservation.spec.ts --testTimeout=60000` (2 suites, 22 tests, all passed) and `npm run build` (passed) after the scratch-database guard and strict login credential checks. That pass did not re-run the full suite, evals, frontend build, or Playwright, and it did not change `operations_hub`. A following pass re-ran `npx jest src/auth/migration-preservation.spec.ts --testTimeout=60000` (1 suite, 6 tests, all passed) and `npm run build` (passed) after closing a scratch client whose connection failed. That pass did not re-run the auth spec, full suite, evals, frontend build, or Playwright, and it did not change `operations_hub`.

Checked on 24 September 2026 after the Super Admin workspace. Neither `operations_hub` nor `operations_hub_test` was reset. `.env` was not modified. `npm test` passed 12 suites and 83 tests, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 10 tests (2 login, 1 company signup, 5 intake, 1 request flow, 1 Super Admin workspace). `npm run eval:ai` was not re-run; intake tests in `npm test` and Playwright intake still passed.

Checked on 24 September 2026 after Super Admin ownership rules. Neither `operations_hub` nor `operations_hub_test` was reset. `.env` was not modified. `npm test` passed 12 suites and 84 tests, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 11 tests (2 login, 1 company signup, 5 intake, 1 request flow, 1 Super Admin workspace, 1 Super Admin requests). `npm run eval:ai` was not re-run; intake code did not change.

Checked on 24 September 2026 after focused Super Admin handling prohibitions. Neither `operations_hub` nor `operations_hub_test` was reset. `.env` was not modified. `npm test` passed 13 suites and 86 tests, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 12 tests (2 login, 1 company signup, 5 intake, 1 request flow, 1 Super Admin workspace, 2 Super Admin requests). `npm run eval:ai` was not re-run; intake code did not change.

Checked on 25 September 2026 after limited Super Admin request oversight. Neither `operations_hub` nor `operations_hub_test` was reset. `.env` was not modified. `npm test` passed 13 suites and 89 tests, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 12 tests. `npm run eval:ai` was not re-run; intake code did not change.

## Documentation

- `docs/product-spec.md` — problem, implemented request and authentication behavior, confirmed full-product requirements, and remaining decisions
- `docs/architecture.md` — Week 1 architecture record plus later product changes
- `docs/data-model.md` — Week 1 conceptual model, current schema notes, and later additions
- `docs/decisions/ADR-001.md` — synchronous request submission
- `docs/decisions/ADR-002-authentication.md` — implemented email/password sessions
- `docs/decisions/ADR-003-company-signup.md` — company signup, invitations, and company-scoped Super Admin access
- `docs/week2-agentic-workflow.md` — Week 2 in-memory lifecycle notes
- `docs/week3-agentic-workflow.md` — Week 3 implementation notes
- `docs/week3-full-stack-delivery.md` — Week 3 delivered slice, API, tests, and evidence
- `docs/week4-production-ai.md` — Week 4 advisory intake, schema, evals, and advisory boundary

## Week 1 / Week 2 context

Week 1 left exact statuses, ownership, and authentication unknown. Week 2 implemented the same lifecycle in memory, without a frontend or database.

Those in-memory IDs and PowerShell cases are **not** the current system. Current evidence is the UI flow above plus `npm test` and `npm run test:e2e`.

Authentication for this branch is implemented in ADR-002. The Super Admin workspace is implemented for Dashboard, Employees, Departments, and the company-wide Requests list. Super Admin may submit and view; they cannot own or handle. Approvals, claiming, and Settings are specified as planned work in `docs/product-spec.md`. They are not implemented. Temporary assignment is not the finished claim path and cannot target Super Admin. Unassigned on the request list is not claimable. Open decisions, including confidentiality beyond the visibility rules, stay in that file.
