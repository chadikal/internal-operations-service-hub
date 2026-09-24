# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized staff can view and handle those requests.

## Current Stage

The current slice is the Week 4 React + NestJS + PostgreSQL app, advisory Request Intake, email/password sessions, and company signup.

An employee signs in with email and password, then describes a need in free text. The API analyzes it with Requesty at runtime (`AI_PROVIDER=requesty`) and returns troubleshooting and/or a draft. Intake never creates a request; the employee reviews the draft and submits through Create Request. Automated tests and evals use `MockAiProvider`.

This is not the full application. Approvals, claiming, account administration screens, and a full department-administration screen are not implemented. A company Super Admin can add a department and invite staff. Confirmed plans for the later work are in [Planned full product](#planned-full-product-not-implemented).

Stack:

```
React/Vite UI (localhost:5173)
  → NestJS API (localhost:3000)
    → Prisma
      → PostgreSQL
```

Identity is an `HttpOnly` cookie named `hub_session`. The UI has Log in, Log out, and Create a company workspace. There is no public employee signup. Protected calls send `X-CSRF-Token`. `X-Actor-Id` is ignored. Each account belongs to one company, and the API will not return another company’s data.

Lifecycle for this slice: `SUBMITTED → IN_PROGRESS → COMPLETED`. `COMPLETED` is terminal. A current owner is required before a transition. Assign and transition still require `canHandle`.

Seeded people: Chadi (`id=1`, IT, `canHandle=true`), John (`id=2`, IT, `canHandle=false`). Department `1` is IT. The company migration attaches existing rows to one Development company and does not invent a password. After that migration their emails and password hashes are still empty, so they cannot log in until credentials are set with the development command below.

## Planned full product (not implemented)

`docs/product-spec.md` is the source for confirmed future requirements. Login, revocable sessions, company signup, company-scoped invitations, one role per account, and separate handler eligibility are implemented and described in `docs/decisions/ADR-002-authentication.md` and `docs/decisions/ADR-003-company-signup.md`. Request visibility in this slice is still the temporary `canHandle` rule, limited to the caller’s company. Still planned: people see their own submissions under the full visibility rules; the claimable queue is eligible unassigned requests in their department, and Assigned to me is the separate list of requests they personally own; colleagues' assigned requests appear on neither list; Super Admin sees all requests in their own company; eligible people claim from the claimable queue, only in their department, never their own submissions, and concurrent claims leave one owner; approval is configurable per department and request type and is captured on the request. A request that requires approval becomes claimable only after approval. Denial keeps the work status, sets approval state to Denied, and never unlocks claiming. Resubmission creates a new request. Deactivation immediately blocks login and new claims, and is rejected while the account owns unfinished work. Login already rejects a deactivated account. The unfinished-work check and claim blocking are not implemented. Work status stays `SUBMITTED → IN_PROGRESS → COMPLETED`.

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
REQUESTY_MODEL=nemotron-3.5-lightning-30b-a3b
REQUESTY_API_KEY=
```

Generate the secret in a shell and put it only in `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

If the password contains `#`, `@`, or `%`, URL-encode those characters (`#` → `%23`).

`REQUESTY_API_KEY` is used only by the NestJS API. Do not put it in frontend env files. Automated tests ignore Requesty and force `AI_PROVIDER=mock`. They also set their own test-only `JWT_SECRET`.

Apply migrations on `operations_hub`. This does not reset the database. Nest does not seed on start, and seed does not set passwords.

```powershell
npx prisma migrate deploy
npx prisma db seed
```

Create a company from the sign-in page: company name, your name, email, and a password of at least 12 characters. Verify the email before the workspace is active. On the development database, with `NODE_ENV=development`, the API logs that verification link. It does not log it for tests or production, and the signup response does not include the token. Production has no mail provider, so signup and invitations fail there and create no records. That is not production onboarding.

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
3. A **problem** shows up to 3 troubleshooting steps first. A **need** skips that and offers to prepare a request.
4. Optional missing details may appear even when a draft is ready; they do not block **Prepare a request**.
5. After yes, edit department, title, and description, then click **Create Request** (existing `POST /requests`).

Thin input such as “I need help.” stays on the form with no draft.

## Exercise the flow

1. Open `http://localhost:5173`.
2. Log in as **John**.
3. Create a request to **IT** (title and description are optional). Note the request ID. Status is **SUBMITTED**.
4. Log out, then log in as **Chadi**. The loaded request clears.
5. Enter the ID under **Request ID** and click **Load Request**.
6. Assign **Chadi** as owner.
7. Click **Start Request**. Status becomes **IN PROGRESS**. History shows `SUBMITTED → IN PROGRESS` by Chadi.
8. Optionally click **Complete Request**.

The UI only exposes the next legal transition. Invalid skips such as `SUBMITTED → COMPLETED` are rejected by the API with **409**.

John can view his own request. John cannot view Chadi's request (**403**). Chadi can view John's request.

## Endpoints

Request routes, `POST /ai/intake`, `GET /employees`, and `GET /departments` require a session cookie. State-changing calls also require `X-CSRF-Token`. `GET /health` is public.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Body: `{ "email", "password" }`. Requires a trusted `Origin`. Sets `hub_session`. |
| POST | `/auth/logout` | Revokes the session and clears the cookie. Requires `X-CSRF-Token`. |
| GET | `/auth/me` | Current account, company, and CSRF token. Does not extend the idle timer. |
| POST | `/auth/signup` | Public, with a trusted `Origin`. Body: `{ "companyName", "name", "email", "password" }`. Creates a pending company and inactive Super Admin. Does not return a token or set a session. |
| POST | `/auth/verify-email` | Public, with a trusted `Origin`. Body: `{ "token" }`. Activates that company and Super Admin. |
| POST | `/auth/invitations` | Company Super Admin only. Body has email, name, departmentId, role, and canHandle. Does not accept a password. |
| POST | `/auth/invitations/accept` | Public, with a trusted `Origin`. Body: `{ "token", "password" }`. The invitee sets the password. |
| POST | `/departments` | Company Super Admin only. Body: `{ "name" }`. |
| GET | `/health` | `{ "ok": true }`. |
| POST | `/requests` | Create. Always `SUBMITTED`. Body: `{ "submittedBy": 2, "departmentId": 1 }` plus optional `title` and `description`. `submittedBy` must match the signed-in account. |
| GET | `/requests/:id` | Fetch a request the account may view. |
| PATCH | `/requests/:id/owner` | Assign owner. Body: `{ "currentOwnerId": 1 }`. Handler only. Owner must have `canHandle` and must not be the submitter. |
| PATCH | `/requests/:id/transition` | Body: `{ "to": "IN_PROGRESS", "changedBy": 1 }`. `changedBy` must match the signed-in account and the current owner. |
| GET | `/requests/:id/history` | Successful status history the account may view. |
| POST | `/ai/intake` | Advisory analyze. Body: `{ "text": "I need a laptop." }`. Does not create a request. |
| GET | `/employees` | Employees for the UI: id, name, departmentId, canHandle. |
| GET | `/departments` | Departments for the UI. |

Visibility inside the caller’s company: `canView = actor.canHandle || request.submittedBy === actor.id`. A request, employee, or department from another company is treated as missing. Handler actions require `canHandle`. Unauthorized in the same company → **403**. Illegal lifecycle edge by an authorized handler → **409**, no history write. Missing request → **404**.

Responses include nested `submitter`, `department`, and `currentOwner` names.

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

Browser E2E (Playwright, 6 tests: 2 login, 1 request-flow, 3 intake). Google Chrome must be installed. Playwright uses `channel: 'chrome'`, not bundled Chromium. Stop anything already listening on ports 3000 or 5173. The API process is started with a test-only `JWT_SECRET` and `operations_hub_test`.

```powershell
npm run test:e2e
```

`npm test` and `npm run test:e2e` refuse to start unless `.env.test` points at the exact database name `operations_hub_test`.

Checked on 22 September 2026. `npm run test:db:setup` had already applied `20260922160000_add_authentication` to `operations_hub_test` only. This pass did not migrate `operations_hub` and did not change its credentials. `npm test` passed 10 suites and 58 tests, `npm run eval:ai` passed 8 evals, `npm run build` passed, `cd frontend; npm run build` passed, and `npm run test:e2e` passed 6 tests. A later pass the same day re-ran `npx jest src/auth/auth.spec.ts src/auth/migration-preservation.spec.ts --testTimeout=60000` (2 suites, 22 tests, all passed) and `npm run build` (passed) after the scratch-database guard and strict login credential checks. That pass did not re-run the full suite, evals, frontend build, or Playwright, and it did not change `operations_hub`. A following pass re-ran `npx jest src/auth/migration-preservation.spec.ts --testTimeout=60000` (1 suite, 6 tests, all passed) and `npm run build` (passed) after closing a scratch client whose connection failed. That pass did not re-run the auth spec, full suite, evals, frontend build, or Playwright, and it did not change `operations_hub`.

## Documentation

- `docs/product-spec.md` — problem, implemented request and authentication behavior, confirmed full-product requirements, and remaining decisions
- `docs/architecture.md` — Week 1 architecture record plus later product changes
- `docs/data-model.md` — Week 1 conceptual model, current schema notes, and later additions
- `docs/decisions/ADR-001.md` — synchronous request submission
- `docs/decisions/ADR-002-authentication.md` — implemented email/password sessions
- `docs/week2-agentic-workflow.md` — Week 2 in-memory lifecycle notes
- `docs/week3-agentic-workflow.md` — Week 3 implementation notes
- `docs/week3-full-stack-delivery.md` — Week 3 delivered slice, API, tests, and evidence
- `docs/week4-production-ai.md` — Week 4 advisory intake, schema, evals, and advisory boundary

## Week 1 / Week 2 context

Week 1 left exact statuses, ownership, and authentication unknown. Week 2 implemented the same lifecycle in memory, without a frontend or database.

Those in-memory IDs and PowerShell cases are **not** the current system. Current evidence is the UI flow above plus `npm test` and `npm run test:e2e`.

Authentication for this branch is implemented in ADR-002. Approvals, claiming, and administration screens are specified as planned work in `docs/product-spec.md`. They are not implemented. Open decisions, including confidentiality beyond the visibility rules, stay in that file.
