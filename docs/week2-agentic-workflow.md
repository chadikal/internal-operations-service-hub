# Week 2 Agentic Workflow

Bounded Service Request lifecycle slice for the Internal Operations Service Hub.

## UNDERSTAND

### Week 1 sources inspected

- `docs/product-spec.md`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/decisions/ADR-001.md`
- `README.md`

No NestJS code existed before this week. The repository was documentation-only.

### Week 1 invariants / rules used

From `docs/data-model.md`:

- Every Request has exactly one submitting Employee.
- Every Request belongs to exactly one Department.
- A Request may have zero or one current owner.
- For the initial version, the current owner updates the Request status.
- A successful status change must preserve previous status, new status, who changed it, and when.
- A failed status change must not create a successful history record.
- Approval and Request status are separate.

From `docs/product-spec.md`: a failed status update must not be presented as successful.

From `docs/architecture.md`: the backend must verify identity/permissions and must not trust identity from the UI alone.

### Week 1 unknowns relevant to this slice

- Exact request statuses and allowed transitions
- How ownership is assigned
- Required submission fields beyond identities
- Authentication, confidentiality, approvals, and supported departments

Week 1 explicitly says the exact statuses and allowed transitions are still unknown. They were **not** treated as already decided.

### Explicit Week 2 assumptions

For the Week 2 bounded lifecycle implementation, we assume the request states `SUBMITTED`, `IN_PROGRESS`, and `COMPLETED`, with the allowed flow `SUBMITTED -> IN_PROGRESS -> COMPLETED`.

Also assumed:

- `COMPLETED` is terminal for this slice.
- `SUBMITTED -> COMPLETED` is not allowed.
- `COMPLETED -> IN_PROGRESS` is not allowed.
- Newly created requests start in `SUBMITTED`. The client cannot choose the initial status.
- A status transition cannot proceed without a current owner.
- `changedBy` in the transition body simulates the actor. This is not authentication.

### Selected bounded slice

`SUBMITTED -> IN_PROGRESS -> COMPLETED`

Endpoints:

- `POST /requests`
- `GET /requests/:id`
- `PATCH /requests/:id/owner`
- `PATCH /requests/:id/transition`
- `GET /requests/:id/history`

### Non-goals

No frontend, UI, real database, authentication/JWT/guards, approvals, cancellation, notifications, comments, attachments, dashboards, employee/department CRUD, assignment history, complete request lifecycle, or full test suite.

Approvals remain part of the overall product design. They are out of scope for this slice because Week 1 left approval rules unknown and kept Approval separate from Request status.

## DIRECT

### Bounded task given to the coding agent

Implement only this Week 2 lifecycle slice as a NestJS API with in-memory storage. Demonstrate two valid transitions, two invalid transitions, the Week 1 status-history invariant, and the Week 1 current-owner rule.

### Context and inspection before modification

Week 1 files were read before any code was added. Named statuses were not copied into Week 1 documents.

### Implementation plan

- Scaffold a small NestJS app at the repository root.
- Store requests in `Map<number, Request>` and history in an in-memory array.
- Keep controllers thin. Put the transition table, owner checks, status mutation, and history append in `RequestsService`.
- Create-time fields: `submittedBy`, `departmentId`. Optional `currentOwnerId` starts as `null`.
- Transition body: `{ to, changedBy }`.
- Reject invalid lifecycle edges, missing owner, and `changedBy !== currentOwnerId` without changing status or appending history.

### Approve / redirect decisions

The first plan treated “cannot move to IN_PROGRESS without an owner” as the primary Week 1 invariant and skipped status history.

That was redirected:

- Status names are Week 2 assumptions, not Week 1 states.
- The primary Week 1 invariant is successful history records vs no history on failure.
- Current-owner updates status, simulated with `changedBy`.
- Add `PATCH /requests/:id/owner` so a request can be created without an owner and assigned later.
- Approvals stay out of this slice.

## PROVE

The API was started with `npm start` on `http://localhost:3000`. PowerShell `Invoke-WebRequest` was used. No defects were found, so no fix/re-verify cycle was needed.

### VALID CASE 1

- Initial: created request `1` as `SUBMITTED`, `currentOwnerId = null`, then assigned owner `7`.
- Action: `PATCH /requests/1/transition` `{ "to": "IN_PROGRESS", "changedBy": 7 }`
- Expected: `200`, status `IN_PROGRESS`, one history record.
- Actual: `200`, status `IN_PROGRESS`, history `SUBMITTED -> IN_PROGRESS`, `changedBy = 7`.

### VALID CASE 2

- Initial: request `1` in `IN_PROGRESS`, owner `7`.
- Action: `PATCH /requests/1/transition` `{ "to": "COMPLETED", "changedBy": 7 }`
- Expected: `200`, status `COMPLETED`, second history record.
- Actual: `200`, status `COMPLETED`, history had two records (`SUBMITTED -> IN_PROGRESS`, then `IN_PROGRESS -> COMPLETED`).

### INVALID CASE 1

- Initial: request `2` `SUBMITTED` with owner `7` (owner assigned so the failure is the skip, not the owner rule).
- Action: `PATCH /requests/2/transition` `{ "to": "COMPLETED", "changedBy": 7 }`
- Expected: rejected, status stays `SUBMITTED`, no history.
- Actual: `409` `"Transition from SUBMITTED to COMPLETED is not allowed"`. Status `SUBMITTED`. History `[]`.

### INVALID CASE 2

- Initial: request `1` `COMPLETED`.
- Action: `PATCH /requests/1/transition` `{ "to": "IN_PROGRESS", "changedBy": 7 }`
- Expected: rejected, status stays `COMPLETED`, history unchanged.
- Actual: `409` `"Transition from COMPLETED to IN_PROGRESS is not allowed"`. Status `COMPLETED`. History still two records.

### WEEK 1 OWNER RULE

- Initial: request `3` `SUBMITTED`, `currentOwnerId = 7`.
- Action: `PATCH /requests/3/transition` `{ "to": "IN_PROGRESS", "changedBy": 12 }`
- Expected: rejected, status unchanged, no history.
- Actual: `409` `"Only the current owner can update the request status"`. Status `SUBMITTED`. History `[]`.

### NO OWNER CASE

- Initial: request `4` `SUBMITTED`, `currentOwnerId = null`.
- Action: `PATCH /requests/4/transition` `{ "to": "IN_PROGRESS", "changedBy": 7 }`
- Expected: rejected, status unchanged, no history.
- Actual: `409` `"A current owner must be assigned before a status transition"`. Status `SUBMITTED`. History `[]`.

### Week 1 history invariant

Successful transitions created history records with `requestId`, `previousStatus`, `newStatus`, `changedBy`, and `changedAt`.

Rejected transitions did not change `status` and did not append a history record.

Exact commands are in `README.md`.
