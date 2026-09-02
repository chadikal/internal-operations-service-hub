# Internal Operations Service Hub - Data Model

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
