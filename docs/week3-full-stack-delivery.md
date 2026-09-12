# Week 3 Full-Stack Delivery

## 1. Slice Delivered

This Week 3 slice is one user-facing Service Request flow:

- React/Vite frontend (`frontend/`, port 5173)
- NestJS API (`src/`, port 3000)
- PostgreSQL persistence through Prisma
- temporary identity via `X-Actor-Id`
- seeded actors: Chadi (`id=1`, IT, `canHandle=true`) and John (`id=2`, IT, `canHandle=false`)
- lifecycle: `SUBMITTED → IN_PROGRESS → COMPLETED`

Chosen journey: John submits an IT request. Chadi can view it, become owner, start it, and complete it. The UI only offers the next legal transition. `X-Actor-Id` is a demo stand-in, not login.

Approvals, employee/department CRUD, and real authentication are not part of this slice.

## 2. API Contract

Request routes require header `X-Actor-Id` (positive integer employee id). Lookups do not.

### `POST /requests`

Creates a request as the actor. Always starts `SUBMITTED` with `currentOwnerId: null`.

```http
X-Actor-Id: 2
{ "submittedBy": 2, "departmentId": 1 }
```

`submittedBy` must equal `X-Actor-Id`. **201** includes nested `submitter`, `department`, and `currentOwner` (null until assigned).

### `GET /requests/:id`

Returns one request if the actor may view it. **200**, **403**, or **404**.

### `PATCH /requests/:id/owner`

```http
X-Actor-Id: 1
{ "currentOwnerId": 1 }
```

Actor must have `canHandle`. Assigned owner must have `canHandle` and must not be the submitter. **200**. Does not write history.

### `PATCH /requests/:id/transition`

```http
X-Actor-Id: 1
{ "to": "IN_PROGRESS", "changedBy": 1 }
```

`changedBy` must match `X-Actor-Id` and the current owner. Allowed: `SUBMITTED → IN_PROGRESS`, `IN_PROGRESS → COMPLETED`. Success **200** writes status and one history row in a transaction. Illegal edges **409** with no write.

### `GET /requests/:id/history`

Successful status changes only, same visibility as GET request. Each row includes `previousStatus`, `newStatus`, `changedBy`, `changedAt`, and `changedByEmployee`.

### `GET /employees`

`{ id, name, departmentId, canHandle }[]`. No actor header.

### `GET /departments`

`{ id, name }[]`. No actor header.

## 3. Authorization Rule

Implemented in `RequestsService`:

- `canHandle=true` means handler
- a non-handler may view only requests they submitted
- a handler may view requests they are authorized to handle (in this slice: any request)
- only handlers may assign owners or transition
- the assigned owner must be a handler and must not be the submitter
- only the current owner may transition (`changedBy` must match owner and `X-Actor-Id`)

Allowed:

- John `GET` his own request → **200**
- Chadi `GET` John's request → **200**

Denied:

- John `GET` Chadi's request → **403** `You are not allowed to view this request`

`X-Actor-Id` plus the UI `Acting as: Chadi | John` switcher is temporary Week 3 identity, not authentication.

## 4. Invalid Request

Authorized Chadi, request still `SUBMITTED`, owner already Chadi, calls the API:

`PATCH /requests/:id/transition` `{ "to": "COMPLETED", "changedBy": 1 }`

Result:

- **409** `Transition from SUBMITTED to COMPLETED is not allowed`
- PostgreSQL status remains `SUBMITTED`
- `currentOwnerId` remains Chadi
- no `RequestStatusHistory` row

The React UI does not expose this skip. It is tested at the API boundary so the backend enforces the lifecycle even if a client calls it directly.

## 5. Expected Failure

Distinct from **403** and **409**:

`GET /requests/:id` for a numeric id that does not exist, with valid `X-Actor-Id: 1`.

Result: **404** `Request {id} was not found`.

## 6. Business-Rule Automated Test

`src/requests/requests.business-rules.spec.ts`

- John submits; John `GET` own request → **200**
- Chadi `GET` John's request → **200**
- John `GET` Chadi's request → **403** `/not allowed to view/`

HTTP/Supertest against the real Nest app on `operations_hub_test`.

## 7. Backend ↔ Database Integration Test

`src/requests/requests.persistence.spec.ts`

John creates → Chadi owns → Chadi `SUBMITTED → IN_PROGRESS`. After HTTP **200**, the test queries PostgreSQL through `PrismaService` (not only `GET /requests/:id`).

Evidence:

- `status === IN_PROGRESS`
- `submittedBy === 2` (John)
- `currentOwnerId === 1` (Chadi)
- exactly one history row: `SUBMITTED → IN_PROGRESS`, `changedBy === 1`

## 8. Regression Protection

`src/requests/requests.lifecycle.spec.ts`

Valid path after Prisma and authorization:

John creates → Chadi owns → `SUBMITTED → IN_PROGRESS` → `IN_PROGRESS → COMPLETED`.

Prisma then asserts `COMPLETED` and exactly two ordered history rows, both `changedBy` Chadi.

The same file also covers the invalid skip (**409**, status still `SUBMITTED`, history count 0) and the **404** missing-id failure.

## 9. Browser E2E

`e2e/request-flow.spec.ts`

One Playwright journey: React → NestJS → PostgreSQL → visible React state.

John → create IT request → see **SUBMITTED** → switch Chadi (loaded request clears) → load ID → assign Chadi → Start Request → see **IN PROGRESS** → history `SUBMITTED → IN PROGRESS` by Chadi.

The test stops at `IN_PROGRESS`. Full `COMPLETED` is covered by the lifecycle spec.

Playwright uses installed Google Chrome (`channel: 'chrome'` in `playwright.config.ts`). Bundled Chromium was not used because that download was unavailable during development.

## 10. Test Database Isolation

| Use | Database |
| --- | --- |
| Development (`npm start`) | `operations_hub` via `.env` |
| Automated tests | `operations_hub_test` via `.env.test` |

Wiring:

- `.env.test.example`
- `scripts/load-test-env.cjs`
- `scripts/setup-test-db.cjs`
- `src/jest.setup.ts`
- Playwright config and `e2e/db.ts` call the same loader

Automated tests refuse to run unless `DATABASE_URL` in `.env.test` parses to the exact database name `operations_hub_test`. They do not fall back to `.env`.

Request and history rows are deleted before and after each test. Seeded employees and departments are not deleted.

## 11. Evidence Commands

```powershell
npm run test:db:setup
npm test
npm run test:e2e
```

Verified results:

- Backend: 3 suites passed, 6 tests passed
- Browser: 1 passed

There is no CI or deployment in this slice.

## 12. Known Week 3 Boundaries

- `X-Actor-Id` is temporary identity, not real authentication
- `Employee.canHandle` is temporary handler authorization, not a roles system
- approvals are not implemented
- deployment, CI, and monitoring are out of scope
- one narrow request flow is intentionally what was delivered
