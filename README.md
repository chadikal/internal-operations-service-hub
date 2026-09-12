# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized staff can view and handle those requests.

## Current Stage

Week 3 delivers one vertical slice: a React view, a NestJS API, and PostgreSQL persistence through Prisma.

This is not the full application. There is no real authentication. `X-Actor-Id` is a temporary demo stand-in. Approvals, employee CRUD, and department CRUD are out of scope.

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
```

If the password contains `#`, `@`, or `%`, URL-encode those characters (`#` → `%23`).

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

## Exercise the flow

1. Open `http://localhost:5173`.
2. Select **John**.
3. Create a request to **IT**. Note the request ID. Status is **SUBMITTED**.
4. Select **Chadi**. The loaded request clears.
5. Enter the ID under **Request ID** and click **Load Request**.
6. Assign **Chadi** as owner.
7. Click **Start Request**. Status becomes **IN PROGRESS**. History shows `SUBMITTED → IN PROGRESS` by Chadi.
8. Optionally click **Complete Request**.

The UI only exposes the next legal transition. Invalid skips such as `SUBMITTED → COMPLETED` are rejected by the API with **409**.

John can view his own request. John cannot view Chadi's request (**403**). Chadi can view John's request.

## Endpoints

Request routes require `X-Actor-Id`. `GET /employees` and `GET /departments` do not.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/requests` | Create. Always `SUBMITTED`. Body: `{ "submittedBy": 2, "departmentId": 1 }`. `submittedBy` must match `X-Actor-Id`. |
| GET | `/requests/:id` | Fetch a request the actor may view. |
| PATCH | `/requests/:id/owner` | Assign owner. Body: `{ "currentOwnerId": 1 }`. Handler only. Owner must have `canHandle` and must not be the submitter. |
| PATCH | `/requests/:id/transition` | Body: `{ "to": "IN_PROGRESS", "changedBy": 1 }`. `changedBy` must match `X-Actor-Id` and the current owner. |
| GET | `/requests/:id/history` | Successful status history the actor may view. |
| GET | `/employees` | Seeded employees for the UI. |
| GET | `/departments` | Seeded departments for the UI. |

Visibility: `canView = actor.canHandle || request.submittedBy === actor.id`. Handler actions require `canHandle`. Unauthorized → **403**. Illegal lifecycle edge by an authorized handler → **409**, no history write. Missing request → **404**.

Responses include nested `submitter`, `department`, and `currentOwner` names.

## Tests

Automated tests use a **separate** database, `operations_hub_test`. They will not run against `operations_hub`.

Create `operations_hub_test` once in PostgreSQL. Copy `.env.test.example` to `.env.test`:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/operations_hub_test"
```

Prepare schema and seed on the test database only:

```powershell
npm run test:db:setup
```

Backend (Jest, 3 suites / 6 tests):

```powershell
npm test
```

Browser E2E (Playwright, 1 test). Google Chrome must be installed. Playwright uses `channel: 'chrome'`, not bundled Chromium. Stop anything already listening on ports 3000 or 5173.

```powershell
npm run test:e2e
```

`npm test` and `npm run test:e2e` refuse to start unless `.env.test` points at the exact database name `operations_hub_test`.

## Documentation

- `docs/product-spec.md` — Week 1 problem, requirements, unknowns
- `docs/architecture.md` — actors, components, flow, authorization decision
- `docs/data-model.md` — entities and relationships
- `docs/decisions/ADR-001.md` — synchronous request submission
- `docs/week2-agentic-workflow.md` — Week 2 in-memory lifecycle notes
- `docs/week3-agentic-workflow.md` — Week 3 implementation notes
- `docs/week3-full-stack-delivery.md` — Week 3 delivered slice, API, tests, and evidence

## Week 1 / Week 2 context

Week 1 left exact statuses, ownership, and authentication unknown. Week 2 implemented the same lifecycle in memory, without a frontend or database.

Those in-memory IDs and PowerShell cases are **not** the current system. Current evidence is the UI flow above plus `npm test` and `npm run test:e2e`.

At the full-product level, authentication, approvals, confidentiality, and extra request fields remain undefined. This slice does not resolve them.
