# Week 3 Agentic Workflow

Bounded full-stack vertical slice: existing NestJS request lifecycle, Prisma/PostgreSQL persistence, and one React view.

## UNDERSTAND

### Week 1 / Week 2 sources inspected

- `docs/product-spec.md`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/decisions/ADR-001.md`
- `docs/week2-agentic-workflow.md`
- `README.md`
- `src/requests/*`

### Week 1 decisions preserved

No Week 1 product or architecture decision was changed.

Relational IDs remain on Request. Names come from Employee and Department relations. Approval stays out of scope. Assignment history is not stored. `changedBy` is still a simulated actor, not authentication.

Week 1 already preferred a relational database. Week 3 implements that with Prisma and local PostgreSQL through `DATABASE_URL` only.

### Week 2 assumptions preserved

`SUBMITTED -> IN_PROGRESS -> COMPLETED`, terminal `COMPLETED`, skip/back rejected, owner required before a transition, history only on success.

Existing endpoints were kept:

- `POST /requests`
- `GET /requests/:id`
- `PATCH /requests/:id/owner`
- `PATCH /requests/:id/transition`
- `GET /requests/:id/history`

### Week 3 additions

- PostgreSQL persistence via Prisma
- Read-only `GET /employees` and `GET /departments` for seeded UI dropdowns
- Additive name fields on request/history responses
- One Vite React view on port 5173
- CORS for `http://localhost:5173`

## DIRECT

Replace in-memory `Map`/array storage with Prisma. Keep lifecycle checks in `RequestsService`. Write status + history in one transaction. Seed IT, HR, Finance, Chadi, and John. Do not reseed on Nest start. Do not add auth, Approval, CRUD, Docker, or Neon-specific code.

Redirects during implementation:

- Nest was compiling `frontend/`; `frontend` and `prisma` were excluded from the Nest tsconfig.
- Prisma connects only through `DATABASE_URL` to local PostgreSQL.
- Authorization uses `Employee.canHandle` and `X-Actor-Id`, not a roles system. Both seeded users stay in IT.

## Week 3 Assumptions and Decisions

These are assignment assumptions and decisions for this Week 3 slice. They do not resolve the corresponding unknowns in `docs/product-spec.md`.

- Real authentication remains unresolved and out of scope.
- `X-Actor-Id` plus the React `Acting as: Chadi | John` switcher is only a temporary Week 3 identity mechanism. It is not login, JWT, sessions, or the final authentication solution.
- `Employee.canHandle` is the temporary handler-authorization flag. It is not a roles or permissions system.
- Department membership alone does not grant handler permission.
- Chadi and John are both in IT. Chadi has `canHandle = true`. John has `canHandle = false`.
- A non-handler may only view requests they submitted. A handler may view requests they are authorized to handle.
- Request history follows the same visibility rule.
- Only employees with `canHandle = true` may become owners or perform handler actions.
- A request submitter cannot own that same request, even if they have `canHandle = true`.
- Employees may submit requests to their own department. Submission permission and handling/ownership permission are separate.
- The assignment lifecycle remains `SUBMITTED → IN_PROGRESS → COMPLETED`. `SUBMITTED → COMPLETED` is invalid.
- Unauthorized actions return `403 Forbidden`. An illegal lifecycle transition by an authorized actor returns `409 Conflict`.

## PROVE

Database: local PostgreSQL `operations_hub` at `localhost:5432`. Seed is a separate `npx prisma db seed` command. Seed does not create requests.

### Successful transition

John cannot be owner (`canHandle = false`). Chadi cannot own a request he submitted. The valid path is: John submits, Chadi owns, Chadi transitions.

- Create request: `submittedBy = 2` (John), `departmentId = 1` (IT)
- Assign owner `1` (Chadi)
- `SUBMITTED -> IN_PROGRESS` with `changedBy = 1`
- Expected: 200, status `IN_PROGRESS`, one history record by Chadi

### Invalid transition

- Request submitted by John, owned by Chadi, still `SUBMITTED`, `to = COMPLETED`
- Expected: 409, status stays `SUBMITTED`, no history
- Actual: matched. `409` `"Transition from SUBMITTED to COMPLETED is not allowed"`.

### Persistence across restart

- Stop Nest after a successful `IN_PROGRESS` transition
- Start Nest again without reseeding
- GET the same request and history with `X-Actor-Id: 1`
- Expected: still `IN_PROGRESS`; the same history row remains

### React UI

The UI was implemented as a single view that creates/loads a request, assigns an eligible owner, starts/completes, shows history, and shows backend errors. It refetches after mutations. Eligible owners exclude non-handlers and the request submitter.

Exact API commands are in `README.md`.
