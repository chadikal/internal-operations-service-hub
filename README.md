# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized staff can view and handle those requests.

## Current Stage

Week 4 / v0.4 is the current slice: the Week 3 React + NestJS + PostgreSQL app plus advisory Request Intake.

An employee can describe a need in free text. The API analyzes it with Requesty at runtime (`AI_PROVIDER=requesty`) and returns troubleshooting and/or a draft. Intake never creates a request; the employee reviews the draft and submits through the existing Create Request path. Automated tests and evals use `MockAiProvider`.

This is not the full application. There is no real authentication. `X-Actor-Id` is a temporary demo stand-in. Approvals, account administration, and department administration are not implemented in this slice. Confirmed plans for that later work are in [Planned full product](#planned-full-product-not-implemented).

Stack:

```
React/Vite UI (localhost:5173)
  → NestJS API (localhost:3000)
    → Prisma
      → PostgreSQL
```

Temporary actor identity: header `X-Actor-Id`. The UI has `Acting as: Chadi | John`.

Lifecycle for this slice: `SUBMITTED → IN_PROGRESS → COMPLETED`. `COMPLETED` is terminal. A current owner is required before a transition.

Seeded actors: Chadi (`id=1`, IT, `canHandle=true`), John (`id=2`, IT, `canHandle=false`). Department `1` is IT.

## Planned full product (not implemented)

`docs/product-spec.md` is the source for confirmed future requirements. In short: email/password sign-in with JWT and no public registration; Super Admin provisions accounts, and the first Super Admin comes from a one-time setup command; each account has one role, Employee, Department Admin, or Super Admin; handler eligibility is a separate permission; people see their own submissions; the claimable queue is eligible unassigned requests in their department, and Assigned to me is the separate list of requests they personally own; colleagues' assigned requests appear on neither list; Super Admin sees all; eligible people claim from the claimable queue, only in their department, never their own submissions, and concurrent claims leave one owner; approval is configurable per department and request type and is captured on the request. A request that requires approval becomes claimable only after approval. Denial keeps the work status, sets approval state to Denied, and never unlocks claiming. Resubmission creates a new request. Deactivation immediately blocks login and new claims, and is rejected while the account owns unfinished work. Work status stays `SUBMITTED → IN_PROGRESS → COMPLETED`.

Release and reassignment, password reset, and JWT/session design are still open. Do not treat them as decided.

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

Create a database named `operations_hub`. Copy `.env.example` to `.env` and set `DATABASE_URL`:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/operations_hub"
AI_PROVIDER=requesty
REQUESTY_MODEL=nemotron-3.5-lightning-30b-a3b
REQUESTY_API_KEY=
```

If the password contains `#`, `@`, or `%`, URL-encode those characters (`#` → `%23`).

`REQUESTY_API_KEY` is used only by the NestJS API. Do not put it in frontend env files. Automated tests ignore Requesty and force `AI_PROVIDER=mock`.

Apply migrations and seed once. Nest does not seed on start.

```powershell
npx prisma migrate deploy
npx prisma db seed
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

1. Open `http://localhost:5173` and select an actor.
2. In **Request Intake**, describe what you need and click **Analyze**. Nothing is submitted.
3. A **problem** shows up to 3 troubleshooting steps first. A **need** skips that and offers to prepare a request.
4. Optional missing details may appear even when a draft is ready; they do not block **Prepare a request**.
5. After yes, edit department, title, and description, then click **Create Request** (existing `POST /requests`).

Thin input such as “I need help.” stays on the form with no draft.

## Exercise the flow

1. Open `http://localhost:5173`.
2. Select **John**.
3. Create a request to **IT** (title and description are optional). Note the request ID. Status is **SUBMITTED**.
4. Select **Chadi**. The loaded request clears.
5. Enter the ID under **Request ID** and click **Load Request**.
6. Assign **Chadi** as owner.
7. Click **Start Request**. Status becomes **IN PROGRESS**. History shows `SUBMITTED → IN PROGRESS` by Chadi.
8. Optionally click **Complete Request**.

The UI only exposes the next legal transition. Invalid skips such as `SUBMITTED → COMPLETED` are rejected by the API with **409**.

John can view his own request. John cannot view Chadi's request (**403**). Chadi can view John's request.

## Endpoints

Request routes and `POST /ai/intake` require `X-Actor-Id`. `GET /employees` and `GET /departments` do not.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/requests` | Create. Always `SUBMITTED`. Body: `{ "submittedBy": 2, "departmentId": 1 }` plus optional `title` and `description`. `submittedBy` must match `X-Actor-Id`. |
| GET | `/requests/:id` | Fetch a request the actor may view. |
| PATCH | `/requests/:id/owner` | Assign owner. Body: `{ "currentOwnerId": 1 }`. Handler only. Owner must have `canHandle` and must not be the submitter. |
| PATCH | `/requests/:id/transition` | Body: `{ "to": "IN_PROGRESS", "changedBy": 1 }`. `changedBy` must match `X-Actor-Id` and the current owner. |
| GET | `/requests/:id/history` | Successful status history the actor may view. |
| POST | `/ai/intake` | Advisory analyze. Body: `{ "text": "I need a laptop." }`. Does not create a request. |
| GET | `/employees` | Seeded employees for the UI. |
| GET | `/departments` | Seeded departments for the UI. |

Visibility: `canView = actor.canHandle || request.submittedBy === actor.id`. Handler actions require `canHandle`. Unauthorized → **403**. Illegal lifecycle edge by an authorized handler → **409**, no history write. Missing request → **404**.

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

Browser E2E (Playwright, 4 tests: 1 request-flow + 3 intake). Google Chrome must be installed. Playwright uses `channel: 'chrome'`, not bundled Chromium. Stop anything already listening on ports 3000 or 5173.

```powershell
npm run test:e2e
```

`npm test` and `npm run test:e2e` refuse to start unless `.env.test` points at the exact database name `operations_hub_test`.

## Documentation

- `docs/product-spec.md` — problem, implemented Week 4 behavior, confirmed full-product requirements, and remaining decisions
- `docs/architecture.md` — Week 1 architecture record plus proposed full-product changes
- `docs/data-model.md` — Week 1 conceptual model, Week 4 schema notes, and proposed additions
- `docs/decisions/ADR-001.md` — synchronous request submission
- `docs/week2-agentic-workflow.md` — Week 2 in-memory lifecycle notes
- `docs/week3-agentic-workflow.md` — Week 3 implementation notes
- `docs/week3-full-stack-delivery.md` — Week 3 delivered slice, API, tests, and evidence
- `docs/week4-production-ai.md` — Week 4 advisory intake, schema, evals, and advisory boundary

## Week 1 / Week 2 context

Week 1 left exact statuses, ownership, and authentication unknown. Week 2 implemented the same lifecycle in memory, without a frontend or database.

Those in-memory IDs and PowerShell cases are **not** the current system. Current evidence is the UI flow above plus `npm test` and `npm run test:e2e`.

Authentication, approvals, and administration are specified as planned work in `docs/product-spec.md`. They are not implemented. Open decisions, including confidentiality beyond the visibility rules, stay in that file.
