# Internal Operations Service Hub - Data Model

The entity list below is the Week 1 conceptual model. It is not a mirror of the current Prisma schema, and it is not the planned full-product schema.

Implemented in `prisma/schema.prisma`:

- `Company` has `name` and `status` (`PENDING` or `ACTIVE`). The name is not unique. Existing rows were attached to one `ACTIVE` company named Development. That migration does not delete rows or set passwords.
- **Company boundary is implemented.** Accounts, departments, requests, history, and sessions belong to one company. Callers cannot read or change another company’s rows by id. Production email delivery, invitation resend, multiple-company membership, and unique company names are still unresolved. See ADR-003.
- `Employee` has `companyId`, nullable `departmentId`, `name`, `canHandle`, nullable `email`, nullable `passwordHash`, `role` (`EMPLOYEE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`, default `EMPLOYEE`), and `active` (default true). Email stays unique across companies.
- `Department`, `Request`, `RequestStatusHistory`, and `Session` each have a required `companyId`.
- `EmailVerification` and `Invitation` store a SHA-256 token hash, an expiry, and `usedAt`. The raw token is not stored.
- `Session` stores the revocable login: id, `accountId`, `companyId`, `csrfToken`, `createdAt`, `lastActivityAt`, `absoluteExpiresAt`, and `revokedAt`.
- `Request` has optional `title` and `description`, `currentOwnerId`, status `SUBMITTED`, `IN_PROGRESS`, or `COMPLETED`, `submittedAt`, optional `requestTypeId`, optional `capturedApprovalPolicy`, and optional `approvalState` (`NOT_REQUIRED`, `PENDING`, `APPROVED`, or `DENIED`). `submittedAt` is set at create. Existing rows were filled from `statusUpdatedAt` because no earlier submit time was stored. New creates require a type, snapshot the live policy, and set `NOT_REQUIRED` for `NONE` or `PENDING` otherwise. Existing rows without those columns stay null and are not backfilled. `ApprovalDecision` stores one outcome per request: decision, reason (required for denial), approver, role at decision time, and time. Work status stays on `Request.status`. The request detail timeline derives Submitted, and when approval is required Awaiting Approval plus Approved or Denied from `ApprovalDecision`, then Unclaimed, Claimed, and the stored work-status changes. `claimedAt` is set only when a claim succeeds and stays null on older owned rows, so the timeline does not invent a claim time. Policy `NONE` does not add approval steps. Denial ends that timeline. Those labels are not written into `Request.status` or `RequestStatusHistory`.
- `RequestStatusHistory` stores successful work-status changes.
- `RequestType` belongs to one company and one destination department. It has `name` and `approvalPolicy` (`NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`). Super Admin creates, renames, and edits types. Types are not deleted in this slice except when an unused department is deleted.
- There is no `Approval` table. Accounts are `Employee` rows, not a separate account table. A founder’s `departmentId` may be null. Staff invitations require a department in the same company. The create-workspace wizard persists the founder’s confirmed departments and request types. A signup that omits that list still creates ordinary IT, HR, and Finance `Department` rows and does not create request types. Those names are not locked. Super Admin may rename them and may delete a department that has no employees and no requests. Existing companies, including Development, are not backfilled.
- The Super Admin company request list reads existing `Request` rows in that `companyId`. It does not add a table. Super Admin cannot be `currentOwnerId`; assignment and work-status changes reject a Super Admin actor. `currentOwnerId` null is Unclaimed, not a claimable flag. Super Admin approval is `ApprovalDecision`, not ownership.
- **Super Admin oversight (implemented).** `GET /admin/requests` returns ID, submitter name, title, submitter department (live from `Employee.departmentId`, nullable), destination department, status, and `mine`. It does not return description, owner, approval state, or last-update fields. `GET /requests/:id` and history are full detail for that Super Admin’s submissions and for captured `SUPER_ADMIN` requests they did not submit. Unrelated same-company ids are **403**. Another company’s id is **404**. Company-wide body access is not restored. Whether employee department should later be a snapshot at submit is unresolved.

Week 1 sentences below that say statuses, title, and description are unknown describe that original pass. The implementation notes above are the current database. [Later additions](#later-additions) mix implemented schema with remaining planned tables. Unresolved items stay in `docs/product-spec.md`.

## Domain

### Entities

#### Employee

- id
- name
- department_id
- role

Department staff are also Employees, so they can handle requests for their department and can also submit their own requests to another department.

#### Department

- id
- name

#### Request

- id
- submitted_by
- department_id
- current_owner_id
- current_status
- status_updated_at

`current_owner_id` is optional because a Request may exist before an Employee is assigned to handle it.

The exact fields required when submitting a Request are still unknown, so fields such as title, description, priority, category, and attachments are not added yet.

#### RequestStatusHistory

- id
- request_id
- previous_status
- new_status
- changed_by
- changed_at

#### Approval

- id
- request_id
- decision_by
- outcome
- decided_at

The exact approval outcomes and workflow are still unknown.

### Relationships and Cardinality

- One Department can have many Employees.
- One Employee can submit many Requests.
- Every Request is submitted by exactly one Employee.
- One Department can receive many Requests.
- Every Request belongs to exactly one Department.
- One Employee can currently own many Requests.
- A Request can have zero or one current owner.
- One Request can have zero or many RequestStatusHistory records.
- Every RequestStatusHistory record belongs to exactly one Request.
- One Request can have zero or many Approval records.
- Every Approval belongs to exactly one Request.

### Ownership

A Request has two Employee relationships:

- `submitted_by` identifies who submitted it.
- `current_owner_id` identifies who is currently responsible for handling it.

The submitter and current owner do not need to be the same Employee.

Assignment history is not stored because the current requirements only need the current owner.


## Lifecycle + Rules

### Lifecycle

A Request stores its current state in:

current_status
status_updated_at

Every successful status change is also stored in RequestStatusHistory.

The exact statuses and allowed transitions are still unknown, so they are not defined yet.

### Invariants

- Every Request must have exactly one submitting Employee.
- Every Request must belong to exactly one Department.
- A Request may have zero or one current owner.
- If a Request has an owner, that Employee must be authorized to handle Requests for that Department.
- For the initial version, the current owner updates the Request status.
- A successful status change must preserve the previous status, new status, Employee who changed it, and time of the change.
- A failed status change must not create a successful history record.
- Every Approval must belong to a Request.
- Approval and Request status are separate.

### Authorization-Sensitive Rules

- Employees can view the Requests they submitted.
- Department staff can view Requests sent to their Department when authorized.
- The backend must verify authorization before assigning Request ownership.
- Authorization must be enforced by the backend rather than trusted from the UI.

The exact role structure, confidentiality rules, ownership assignment process, and approval permissions are still unknown.


## Storage

### Storage Choice

A relational database is preferred because the entities are strongly related and those relationships need to stay consistent.

The model can reference related records instead of duplicating Employee or Department data inside every Request.

Main relationships include:

Employee.department_id -> Department.id

Request.submitted_by -> Employee.id
Request.department_id -> Department.id
Request.current_owner_id -> Employee.id

RequestStatusHistory.request_id -> Request.id
RequestStatusHistory.changed_by -> Employee.id

Approval.request_id -> Request.id
Approval.decision_by -> Employee.id

### Durable Data

The system should store:

- Request submitter
- Request destination Department
- Current Request owner
- Current Request status
- Time the current status was last updated
- Request status history
- Approval records

Both current status and status history are stored. This allows the current state to be read directly while previous changes are still preserved.

### Derived Data

The following can be calculated instead of stored separately:

- Number of Requests submitted by an Employee
- Number of Requests belonging to a Department
- Number of Requests with a particular status

Values such as "open Requests" cannot be defined yet because the exact Request statuses are still unknown.


## Access

### Requests submitted by an Employee

Important query:

Request.submitted_by

Possible index:

Request.submitted_by

### Requests sent to a Department

Important query:

Request.department_id

Possible index:

Request.department_id

### Requests owned by an Employee

Important query:

Request.current_owner_id

Possible index:

Request.current_owner_id

### Status history for a Request

Important query:

RequestStatusHistory.request_id

Possible index:

RequestStatusHistory.request_id

### Approvals for a Request

Important query:

Approval.request_id

Possible index:

Approval.request_id


An index on `Request.current_status` is not added yet because filtering Requests by status has not been confirmed as an important access pattern.

## Later additions

These concepts follow the confirmed requirements in `docs/product-spec.md`. Credential, session, company-boundary, signup default departments, request types, and captured policy columns are now in Prisma. Department templates are a code catalog, not a table. The other items below are not.

- **Deactivation screen and claim blocking.** Login already rejects `active=false` and keeps history. Deactivation is still rejected, in the product rules, while the account owns a request whose work status is not `COMPLETED`. That ownership check and any screen are not implemented. Tests set the flag directly in `operations_hub_test`.
- **Request type (implemented).** Super Admin manages request types per department. Each type uses approval policy `NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`. AI never chooses that policy. Super Admin reviews suggested types and policies from a department template before they apply.
- **Captured approval policy (implemented).** When a request is created, the policy in force for that department and type is stored on that request. Later setting changes do not rewrite it. Existing requests without a snapshot stay readable.
- **Approval decision.** Separate from work status. Stores who decided, the outcome, when, and the denial reason when the outcome is deny. Denial sets the approval state to Denied and leaves work status unchanged. A request whose captured policy is not `NONE` is on the claimable queue only after approval. Denial never puts it there. Resubmission is a new Request; the original decision stays. The submitter cannot be the decider for their own request. Self-approval is never an implicit fallback. What happens when the only Super Admin submits a `SUPER_ADMIN` request is unresolved in the product spec. Approval state, inbox, and decisions are implemented. Staff self-claim of an opened request is implemented. An unassigned row with a null approval state and no required captured policy can be claimed without rewriting that null. A null state with captured policy `DEPARTMENT_ADMIN` or `SUPER_ADMIN` waits for a decision. Rows are not backfilled.
- **Department defaults (implemented).** New companies start with deletable IT, HR, and Finance as ordinary `Department` rows (`id`, `name`, `companyId`). Super Admin may rename any of them or delete unused ones. A Department Admin may rename only the department they are assigned to. Delete is **409** while employees or requests exist, matching the Restrict foreign keys. Existing companies are not backfilled.
- **Department templates (implemented).** Optional templates are IT, HR, Finance, Operations, Marketing, Facilities, and Custom/Empty. They are a code catalog, not a Prisma table, and `Department` does not store a template id. Display name is independent of the template. Super Admin reviews suggested types and policies from a template, may edit or remove them, and applies only the confirmed list. Custom/Empty suggests none. The catalog in `docs/product-spec.md` is a recommendation, not company policy. The wizard persists confirmed catalog types at signup. A signup that omits departments does not create types. Super Admin may apply a selected template to any existing department. Duplicate type names in a department return **409**.
- **Employee department on the Super Admin oversight table.** Confirmed columns include the submitter’s department and the destination department. Whether that employee department is a live join from `Employee.departmentId` or a snapshot at submit is unresolved. A founder Super Admin has `departmentId` null today.
- **Company details.** Super Admin manages them. Which fields they contain is still unknown. The company name collected at signup is stored. Super Admin manages the company’s department structure and request types on Departments. A Department Admin can rename only their own department from Settings > My Department and can view that department’s request types. Request-type configuration stays Super Admin-only. Company-details fields are still unknown. Settings shows the company name for Super Admin and is not a company-details editor. Other roles have Profile, Security, and Notifications. Dashboard counts are derived from existing rows and are not stored separately.

The claimable queue is Available: eligible unassigned requests the viewer can claim now. Claimed by Me and Completed are the requests that account owns, split by unfinished work status and `COMPLETED`. My Requests is submissions. Those lists are `GET /requests?queue=`. `GET /requests/:id` and history use that same boundary: the submitter, an eligible handler for work they own or can claim now, or a Department Admin or Super Admin who can decide under the captured policy. An already-owned legacy row stays visible to that handler. Unrelated same-company ids are **403**. Another company is **404**. Administrators do not assign by hand. An eligible handler claims from a card on Available.

`PasswordReset` stores only the SHA-256 hash of a reset token, the company, the account, an expiry one hour after it is created, and `usedAt`. The raw token is not stored. A new reset marks older unused rows for that account used before inserting the new hash. A successful reset sets the password and revokes that account’s open sessions (`Session.revokedAt`). A link is created only for an active account that already has a password and whose company is `ACTIVE`. Unknown and ineligible emails get the same acknowledgement and no row, and only when mail delivery is allowed. Otherwise the request returns **503** before any write. The development database `operations_hub` with `NODE_ENV=development` logs the link. The test database may write the test outbox. No other database logs the token. See ADR-004. Still unknown, so this model does not add behavior for them: release and reassignment, deployment hosting, and the only-Super-Admin `SUPER_ADMIN` submission. Session lifetime, credential columns, and the company boundary are implemented; see ADR-002, ADR-003, and ADR-004.
