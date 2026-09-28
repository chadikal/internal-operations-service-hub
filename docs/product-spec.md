# Internal Operations Service Hub

A company-internal system for requesting and tracking help from departments such as IT, HR, and Finance.

This specification records the product. Weekly delivery notes (`docs/week2-agentic-workflow.md`, `docs/week3-agentic-workflow.md`, `docs/week3-full-stack-delivery.md`, `docs/week4-production-ai.md`) stay historical records of what those slices implemented. Later decisions do not rewrite them.

Labels used below: **Implemented today** is what the running system does. **Confirmed (planned)** is decided product behavior that is not built. **Unresolved** is not decided; implementation must not pick an answer silently.

## Problem / Context

Employees request help from departments such as IT, HR, and Finance through messy channels.

This leads to forgotten requests, requests being sent to the wrong person, and unclear ownership, status, and approval.

## Known Facts

- Employees currently ask for help through messy channels.
- Requests get forgotten.
- Requests get sent to the wrong person.
- Request ownership, status, and approval are unclear.
- The company wants one system to submit, handle, and follow requests.

## Implemented today

The running system is the Week 4 request and intake behavior, email/password sessions from ADR-002, company signup from ADR-003, and the company Super Admin workspace. Weekly notes under `docs/week4-*` still describe the older `X-Actor-Id` slice and were not rewritten.

- A founder creates a company workspace with company name, their name, email, and password. The workspace and that Super Admin stay inactive until the email is verified. The create-workspace wizard starts from IT, HR, and Finance and their template request types. The founder can remove, add, and edit them before signup. Signup persists that confirmed list with the pending company and Super Admin. A signup request that omits the list still creates ordinary IT, HR, and Finance with no request types. Existing companies are not backfilled. There is no public employee signup and no “working alone or in a team” question.
- After verification, that Super Admin can add a department in the company and invite staff. Invitees set their own passwords. The first-Super-Admin command is not the onboarding path and does not create an account.
- Sign-in is email and password. The UI has a login form, show/hide on password fields, logout, and Forgot password. There is no Acting-as switcher. Password reset is a one-hour, single-use link. An unknown email gets the same acknowledgement as a known one when mail can be sent. A successful reset revokes that account’s open sessions. The rules are in ADR-004.
- Protected routes use the `hub_session` cookie. `X-Actor-Id` is ignored. `submittedBy` and `changedBy` must match the signed-in account.
- Every account, department, request type, request, status-history row, and session belongs to one company. A caller cannot read or change another company’s data by sending its ids.
- Seeded people are still Chadi (`canHandle=true`) and John (`canHandle=false`), now in the migrated Development company. An active handler who is not a Super Admin claims an unassigned request in their own department with `POST /requests/:id/claim` when approval is `NOT_REQUIRED` or `APPROVED`. The claim sets the owner and `claimedAt`, and leaves work status `SUBMITTED`. Older claimed rows keep a null `claimedAt`. The owner starts work with the existing transition. The claimer cannot be the submitter and cannot be a Super Admin. `PATCH /requests/:id/owner` does not assign another person.
- Visibility inside the caller’s company is handler access or "I submitted this request" for Employee and Department Admin. Department Admin has handler access by role. Another company’s requests are never visible. Dashboard counts for this company are implemented.
- A company Super Admin may submit requests. They cannot claim, own, assign, or change work status, including through the blocked owner endpoint, even if `canHandle` is true. Handling bans are enforced in `src/requests/requests.service.ts`.
- **Super Admin request oversight.** `GET /admin/requests` lists every request in the Super Admin’s company with only ID, submitter name, title, submitter department, destination department, work status, and a `mine` flag. It does not return description, owner, approval state, or last-update fields, and it does not search description. Dashboard totals stay company-scoped. `GET /requests/:id` and `GET /requests/:id/history` return full detail when that Super Admin submitted the request, and when the captured policy is `SUPER_ADMIN` and they did not submit it. An unrelated request in the same company is **403**. Another company’s id is **404**. Company-wide body access is not restored. The Super Admin Requests page does not open details or history for unrelated rows. Eligible decisions are opened from Approvals.
- Work status is `SUBMITTED → IN_PROGRESS → COMPLETED`. `COMPLETED` is terminal. A current owner is required before a transition. Successful transitions append status history.
- Optional `title` and `description` exist. New requests require a request type that belongs to the selected destination department in the same company. The live `approvalPolicy` on that type (`NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`) is stored on the request at submit as `capturedApprovalPolicy`. Later type edits do not rewrite submitted requests. Existing requests without a type remain readable and keep a null approval state, so they are not sent through the new inbox. New `NONE` requests store `NOT_REQUIRED`. `DEPARTMENT_ADMIN` and `SUPER_ADMIN` requests store `PENDING` until one decision. Optional department templates are a review-and-apply catalog. A signed-in company Super Admin has a sidebar workspace: **Dashboard**, **Staff**, **Departments**, **Requests**, **My Requests**, and **Approvals** work. **Departments** is a company overview: name, employee count, Department Admin names (or None), destination-request count, and awaiting-approval count. **Settings** is Profile, Security, Notifications, and Company. Department and request-type editing is on Departments. Employee and Department Admin accounts cannot open those Super Admin pages or call their APIs. A Department Admin reviews their own approval inbox on the request workspace. Handlers claim from the Available tab. Claimed by Me is the requests they own and have not completed. Those are tabs on Requests, not separate pages. Handler queues and the Department Admin department list use the same table and centered detail overlay as My Requests. The last column is Request Stage. They do not show Employee Department. Claim, start, and complete stay in that overlay.
- The Super Admin dashboard has Requests, Approvals, and My Requests cards for that company. Staff and Departments share one full-width bottom panel: the Staff total and Admins, Handlers, and Employees use most of the width, and a compact Departments count sits on the right and opens the overview. Narrow screens stack that Departments section under Staff. The Staff total is the people total. Department Admin uses Requests, Approvals, My Requests, and Staff for requests destined for their department and people in that department, with no Departments section. Each Requests figure opens the department All requests list with that filter. Approvals are requests submitted by others that this admin can decide, and the Awaiting count matches that list. My Requests is still only what they submitted and shows Submitted, In Progress, Completed, and Unclaimed. Employees and handlers see My Requests, and a handler who is not a Department Admin also sees Requests. Approval totals exclude `NONE` and `NOT_REQUIRED`. Admins and employees partition people; handlers overlap both. Work status, ownership, and approval state stay independent, so those breakdowns are not partial sums of the card total. A count is linked only when the destination shows that exact set. The definitions are in ADR-004. The dashboard does not rank handlers.
- **Requests** is a filterable company-wide oversight list of every department, including colleagues’ requests. It has no All requests / My requests switch. **My Requests** is a separate sidebar page and lists only what that Super Admin submitted, not requests claimed by them; Super Admin cannot own requests. My Requests and Approvals use the same page and table styling as Requests. Shared columns use one order and the same labels: ID, Title, Submitter, Employee Department, Destination Department, and Submitted At. A page shows a shared column only when its list already returns that field. Oversight omits Submitted At. My Requests and Approvals omit Employee Department. The last column is Work Status on oversight, Request Stage on My Requests, and Approval Status on Approvals. The same names are used in request details. Request Stage is derived for display. Approval Status and Work Status stay separate stored values, so a denied request can still show Submitted work status. My Requests filters Approval Status, Work Status (Submitted, In Progress, or Completed), and Claim Status (All, Unclaimed, or Claimed). Claim status applies only to that person’s submissions. Unclaimed is no owner and Claimed is an owner. The filters combine. All approval states includes older rows whose approval state is null. The Approval Status dropdown does not offer a separate empty-state choice. Request details still show those rows, with an em dash when no approval state is stored. Table rows share one height. A title shows at most two lines. Submitter names and submitted dates stay fully readable. Columns use minimum widths, and sideways scrolling stays inside the table. The page and sidebar do not scroll sideways. The authorized detail overlay shows the full title and description. An empty Approvals inbox stays a table with a message that there is nothing to decide. Filters on Requests combine department, Work Status (including Active), and Claim Status (All, Unclaimed, or Claimed), with search on title, submitter name, department names, and id, not description. The oversight list has no claim action. An eligible handler can still claim an unassigned request when approval allows it. New Request and AI Intake are on the dashboard and on My Requests. Each opens the existing form in a centered overlay on My Requests, with Close, Escape, a focus trap, and focus restored to the launching button. Closing keeps unsent input. Super Admin sees no assign, claim, or work-status controls. Eligible handlers claim an opened request in their department, and that claim is rejected while approval is pending or denied. Details and history on the oversight page open only for that Super Admin’s own submissions.
- Staff lists this company’s accounts (name, email, department, role, canHandle, active) with name/email search and combinable department, role, handler-eligibility, and active filters. It never returns password hashes, tokens, or sessions. Super Admin invites any role in the company from an overlay on that page. A Department Admin invites only employees into their own department. Remove deactivates the account and keeps its history.
- Departments lists this company’s departments, including the three signup defaults. Creating, renaming, and deleting a department, and the optional template picker (IT, HR, Finance, Operations, Marketing, Facilities, Custom/Empty), are on the Super Admin Departments page. The entered name stays independent of the template. Super Admin reviews suggested types and policies, may edit or remove them, and applies only the confirmed list in one transaction with a new department. Super Admin may apply a selected template’s confirmed types to an existing department, including IT, HR, Finance, and Maintenance, without inferring a template from the name. Custom/Empty suggests none. The catalog below is a recommendation, not company policy, until Super Admin confirms it. Duplicate type names in a department return **409**. Super Admin may rename any department and may delete one that has no employees and no requests (**409** if either still exists, matching the Restrict foreign keys). That editing lives on the Departments page, under the overview. Super Admin manages the company’s department structure there. A Department Admin renames only their own department from Settings > My Department and can view that department’s request types. Creating, deleting, and request-type configuration stay Super Admin-only. Another department id in the same company is forbidden. A department id outside the company is not found. Company details stay planned. Approval decisions use the captured snapshot and are not edited in Settings.
- Advisory intake can suggest troubleshooting and a draft from the caller’s own departments and request types. It may suggest a `requestTypeId` only from that company’s available types and only when it belongs to the suggested department. A new permission or account entitlement and an existing application or connection that is failing are different intents. If the wording supports more than one of the company’s type names, intake leaves the type unselected so the employee must choose it. The draft stays editable. Submit still stores the selected type’s approval policy. Required missing details block preparing a request; optional suggestions do not. It does not create or change a request. The employee submits through the existing create path. Intake does not answer company-policy questions and cannot choose or override approval policy.
- Departments in the Development company seed are IT, HR, and Finance. Existing employee rows keep their ids. Email and password hash stay empty until credentials are set, so those rows cannot log in yet.

## Confirmed (planned)

These decisions are confirmed for later implementation. Login, company signup, company-scoped invitations, password reset, the Super Admin workspace, limited Super Admin request oversight, signup default departments (IT, HR, Finance), company-scoped request types with a captured policy snapshot, optional department templates, approval state, inboxes, and decisions, handler self-claim from the Requests tabs, and Super Admin department and request-type editing on Departments are implemented. Settings is Profile, Security, and Notifications, with Company for Super Admin and My Department for Department Admin. A Department Admin can rename only their own department there. Request-type configuration stays Super Admin-only. Top-handler ranking and company-details editing are not built. Password reset is a single-use link that expires after one hour.

Later coding slices should follow this order so approval-before-claim is testable from the first claim work:

1. Tighten Super Admin oversight (no schema). **Implemented.** `GET /admin/requests` returns the limited columns. `GET /requests/:id` and history are **200** for that Super Admin’s submissions and for requests they are eligible to decide, **403** for unrelated company requests, and **404** for another company. That extension does not restore company-wide bodies.
2. Signup default departments: deletable IT, HR, Finance on new companies. **Implemented.** The create-workspace wizard starts from those three and their catalog request types. The founder may remove, add, or edit them before signup. Signup persists that confirmed list, including request types, with the pending company. A signup request that omits the list still creates ordinary IT, HR, and Finance with no request types. Super Admin may rename them or delete unused ones. Occupied departments return **409**. Existing companies are not backfilled.
3. Request types and captured policy enum `NONE` | `DEPARTMENT_ADMIN` | `SUPER_ADMIN` on submit. **Implemented.** Super Admin creates, renames, and edits types per destination department. New requests require a valid type in that department. Submit stores `requestTypeId` and a snapshot of `approvalPolicy`. Later type edits do not change submitted requests. Existing requests without a type stay readable. A signup that omits departments starts with no types. The wizard persists the founder’s confirmed types. The Development seed has a General / `NONE` type per default department so John and Chadi can submit. Approval decisions and self-claim are not this slice.
4. Department templates with Super Admin review before suggested types/policies apply. **Implemented.** Optional templates are IT, HR, Finance, Operations, Marketing, Facilities, and Custom/Empty. They are a code catalog; departments do not store a template id. Super Admin chooses a template when creating a department or when applying types to an existing one, including the signup defaults and Maintenance. The entered name stays independent of the template. The product never infers a template from a name. The wizard sends the founder’s confirmed catalog types in the signup transaction. A signup that omits departments does not create types. Super Admin reviews suggested types and policies, may edit or remove them, and applies only the confirmed list, in one transaction with a new department or added beside existing types. The catalog in [Recommended department templates](#recommended-department-templates) is a recommendation, not company policy. Custom/Empty suggests none. Duplicate type names in a department return **409**. Submitted requests keep their type and captured policy.
5. Approval state, inbox, and decisions. **Implemented.** `NONE` stores `NOT_REQUIRED` and needs no decision. `DEPARTMENT_ADMIN` stays `PENDING` until an active Department Admin of the destination department decides. `SUPER_ADMIN` stays `PENDING` until another active company Super Admin decides. The submitter cannot decide their own request. If no other eligible admin exists, the request stays pending and the response says so. It is never approved automatically. Denial requires a reason. The decision stores the outcome, approver, role, and time. A second decision is **409**. Cross-company access is **404**. The wrong department or role is **403**. Work status does not change. Pending and denied requests cannot be claimed or transitioned. Legacy rows with a null approval state stay readable and are not backfilled. An existing owner can still transition them. An unassigned row whose captured policy is null or `NONE` can be claimed, and the null state stays null. A null state whose captured policy is `DEPARTMENT_ADMIN` or `SUPER_ADMIN` stays waiting for that decision.
6. Staff self-claim. **Implemented.** An active employee with handler eligibility claims an unassigned request in their destination department when approval is `NOT_REQUIRED` or `APPROVED`, or when the approval state is null and the captured policy is null or `NONE`. The claim is atomic, sets `currentOwnerId`, and leaves work status `SUBMITTED`. The null legacy state is not rewritten. Pending and denied requests cannot be claimed. A null state with captured policy `DEPARTMENT_ADMIN` or `SUPER_ADMIN` cannot be claimed until that decision is recorded. The submitter, another department, another company, and Super Admin are rejected, including when `canHandle` is true. Two concurrent claims leave one owner. Only that owner can transition. Existing owners and history are kept. `PATCH /requests/:id/owner` is blocked.

### Authentication

People sign in with email and password. There is no public employee signup. A founder creates a company and becomes its first Super Admin after email verification. That Super Admin invites later accounts in the same company, and those people set their own passwords. Company signup and invitations are implemented and recorded in `docs/decisions/ADR-003-company-signup.md`. Session behavior from ADR-002 remains.

The backend verifies identity and enforces permissions. The UI is not the source of identity or authorization.

Cookie sessions, eight-hour absolute expiry, 30-minute idle expiry, revocable sessions, CSRF, Origin checks, and the initial rate limits are implemented. Login admission counts in-flight attempts, and a failed activity timestamp does not turn an already-committed change into an error. The UI clears account-specific data when the session ends or the account changes, and it ignores a late response from the previous session. Password reset emails a single-use link that expires after one hour, returns the same acknowledgement for an unknown email, and revokes that account’s open sessions. Deployment hosting remains unresolved. Super Admin manages the company’s department structure, templates, and request types on Departments. A Department Admin can rename only their own department from Settings. Settings is Profile, Security, and Notifications for every role, plus Company for Super Admin and My Department for Department Admin. Request-type configuration stays Super Admin-only. Approval decisions and handler self-claim are implemented. Employees and Department Admins use the same sidebar layout as Super Admin. The people page is labeled Staff for Super Admin and Department Admin. New Request and AI Intake are buttons on the dashboard and on My Requests, not sidebar items. Each navigates to My Requests and opens that form in a centered overlay. A Department Admin dashboard counts that department’s members and requests whose destination is that department.

### Roles

Each account has one role:

- Employee
- Department Admin
- Super Admin

Handler eligibility is a separate permission for employees, not a role. A Department Admin handles requests in their own department by role, and inviting or assigning that role stores `canHandle` true. An employee may claim only when that permission is on, only for requests in their own department, and never for a request they submitted. A Super Admin may submit requests, see the company-wide limited oversight table, and approve or deny when the captured policy is `SUPER_ADMIN` and they did not submit the request. They never claim, own, or handle requests (assignment and work-status changes), including when `canHandle` is true. They do not automatically receive unrelated descriptions or history.

### Visibility

- Every person sees the requests they submitted, including requests that are waiting for approval or Denied, with the description and history of those submissions.
- **Claimable queue:** eligible unassigned requests in the viewer's department. A request is on this queue only when it has no owner, the viewer has handler eligibility, it is in their department, and they did not submit it. A request whose captured policy is not `NONE` joins this queue only after approval. A request that is waiting for approval, or Denied, is not on this queue. Denial never puts it there.
- **Assigned to me:** requests the viewer personally owns and has not completed. This list is the Claimed by Me tab. It is separate from Available. Completed owned requests are the Completed tab.
- Requests assigned to colleagues are on neither list.
- A request that is waiting for approval stays visible to its submitter and to authorized approvers in the approval inbox. Super Admin sees it on the limited company-wide oversight table. They receive that request’s description and history when they submitted it or are eligible to decide it. They do not receive unrelated bodies.
- Super Admin sees dashboard totals for their own company. The company-wide Requests surface is a limited oversight table: **ID, Title, Submitter, Employee Department, Destination Department, Work Status**. It does not show Submitted At. Their submissions are on the separate My Requests page. Another company’s requests are not visible. Approvals are a separate inbox. Eligible handlers claim from Available on Requests. Super Admin cannot become current owner. `GET /requests/:id` and history use the same boundary as the lists: the submitter, an eligible handler who owns the request or can claim it now, or a Department Admin or Super Admin who can decide it under the captured policy. An already-owned legacy row stays visible to that handler. An unrelated id in the same company is **403**. Another company is **404**.

### Claiming

People with handler eligibility claim an unassigned request in their department themselves. Administrators do not assign an owner by hand. The claimer cannot be the submitter, cannot be a Super Admin, and the request must be in their department. A request can be claimed when approval is `NOT_REQUIRED` or `APPROVED`, and when an older row has a null approval state with no required captured policy. Pending and denied requests cannot be claimed. A null state that still has a required captured policy waits for that decision. If two eligible people claim the same request at the same time, exactly one of them becomes the owner. The owner then uses the existing status transition, and only the owner can do that.

`POST /requests/:id/claim` is the owner path. `GET /requests?queue=` lists `submitted` (My Requests), `available`, `claimed`, `completed`, or `department` (Department Admin policy requests in that admin’s department that they did not submit). The submitted queue accepts Work Status and Claim Status (`unclaimed` or `claimed`). Claim status applies only to the signed-in person’s submissions and is rejected on the other queues. `GET /requests/summary` counts those stored fields for the signed-in person. The display labels Awaiting approval, Denied, Awaiting handler, Approved · awaiting handler, Claimed, In Progress, and Completed are derived in the UI. Approval state, owner, and work status stay separate columns. `PATCH /requests/:id/owner` is blocked so nobody can assign another person. `PATCH /requests/:id/transition` remains the work-status path and only the current owner can use it. Both claim and transition are rejected while the request is pending approval or denied. Unclaimed on the Super Admin list is not a claim button.

A deactivated account cannot claim.

Approval state, inbox, and decisions shipped before self-claim. Self-claim is implemented and enforces approval-before-claim.

### Approval

Each department’s request types use one of `NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`. Super Admin manages those types today. That is the company policy for whether a request of that type needs approval and who may decide. The value in force when a request is created is stored on that request. Later changes to the type apply to new requests only. **Implemented today:** type CRUD, the snapshot, template review, approval state, the role-specific inbox, and approve/deny decisions that act on that snapshot. AI never chooses or applies that policy.

- `NONE`: no approval. Eligible handlers may claim.
- `DEPARTMENT_ADMIN`: the destination Department Admin approves or denies before anyone may claim it.
- `SUPER_ADMIN`: a Super Admin who did not submit the request approves or denies before anyone may claim it.

This enum supersedes the older wording that any required approval could be decided by “the destination Department Admin or a Super Admin.”

The submitter cannot approve or deny their own request. There is no implicit self-approval fallback. Denial requires a reason. Each decision is audited.

Denial leaves work status unchanged and sets approval state to Denied. The original decision stays on that request. Resubmission creates a new request.

Approval state is separate from work status. Work status stays `SUBMITTED → IN_PROGRESS → COMPLETED`.

### Departments and request types

**Implemented today:** new companies start with IT, HR, and Finance as ordinary, company-scoped departments. Super Admin may add further departments, rename any of them, and delete a department that has no employees and no requests. Super Admin creates, renames, and edits request types for each destination department, including `approvalPolicy`. New requests require a type from the selected department. Existing companies, including Development, are not backfilled with signup departments or types. Optional templates are IT, HR, Finance, Operations, Marketing, Facilities, and Custom/Empty. The department’s display name is independent of the template. Super Admin reviews suggested request types and policies, may edit or remove them, and applies only the confirmed list. Custom/Empty suggests none. The create-workspace wizard stores the founder’s confirmed departments and catalog request types. A signup that omits that list still creates IT, HR, and Finance with no types. Super Admin may apply a selected template to any existing department, including IT, HR, Finance, and Maintenance. Selecting Facilities for Maintenance is optional; the product never infers a template from a name. Duplicate type names in a department return **409**. AI never decides company policy.

#### Recommended department templates

These rows are recommendations for Super Admin review. They are not company policy until confirmed. Changing a recommendation does not rename request types already stored for a company and does not rewrite captured approval policies on submitted requests. Later type edits do not rewrite submitted requests either.

| Template | Suggested request type | Recommended policy |
| --- | --- | --- |
| IT | Hardware | NONE |
| IT | Software | NONE |
| IT | Access | DEPARTMENT_ADMIN |
| HR | Leave | DEPARTMENT_ADMIN |
| HR | Certificate | NONE |
| Finance | Expense | DEPARTMENT_ADMIN |
| Finance | Purchase exception | SUPER_ADMIN |
| Operations | Process change | DEPARTMENT_ADMIN |
| Operations | Operational support | NONE |
| Marketing | Campaign | DEPARTMENT_ADMIN |
| Marketing | Brand asset | NONE |
| Facilities | Maintenance / Repair | NONE |
| Facilities | Access badge | DEPARTMENT_ADMIN |
| Custom/Empty | — | — |

**Confirmed (planned):** Company-details screens. Settings is the account page: Profile, Security, Notifications, and Company. Approval decisions that use the captured snapshot are implemented.

### Accounts

Deactivation takes effect immediately. The account cannot sign in or perform authenticated actions. Existing history is kept. The account cannot make new claims.

Deactivation is rejected while the account still owns a request whose work status is not `COMPLETED`.

### Administration

Super Admin manages:

- departments
- accounts, the single role on each account, and handler eligibility
- request types
- approval settings
- company details

## Actors / Stakeholders

### Actors

- Employees, who submit requests and follow their own submissions. With handler eligibility, they also claim eligible work in their department.
- Department Admins, who approve or deny requests for their department when the captured policy is `DEPARTMENT_ADMIN`. The role itself lets them claim eligible requests in that same department, except their own submissions. Handling does not depend on the stored handler flag.
- Super Admin, who sees dashboard totals and the limited oversight table for their own company, invites accounts in that company, and manages the configuration above for that company only. Super Admin may submit requests. When approvals exist, Super Admin may approve or deny a request whose captured policy is `SUPER_ADMIN` (except a request they submitted). Super Admin never claims, owns, or handles requests, including through the blocked owner endpoint. Super Admin does not automatically receive unrelated descriptions or history. A Super Admin has no access to another company.

Department staff from the original problem (HR, IT, Finance) are accounts in these roles, not a separate kind of account.

### Stakeholders

- Employees
- HR, IT, and Finance departments
- Super Admin, for configuration of their own company

## Functional Requirements

- Employees can submit help requests to a department.
- The system shows who currently owns a request when someone has claimed it.
- Employees can view their submitted requests and the current work status.
- Accounts with handler eligibility who are not Super Admin claim claimable unassigned requests in their department and update work status on requests they own. Super Admin may submit, see the limited oversight table, and will approve or deny when that feature exists and the captured policy makes them eligible. Super Admin does not claim, own, or handle, and does not automatically receive unrelated descriptions or history.
- Department Admins review a separate approval inbox when the captured policy is `DEPARTMENT_ADMIN`. Super Admins review the approval inbox when the captured policy is `SUPER_ADMIN`. Pending-approval requests are not in the claimable queue.
- A denial keeps the current work status, records Denied, and leaves that request unclaimable. A later submission is a new request.
- A founder creates a company workspace and verifies their email before that workspace or Super Admin account is active. New companies start with deletable IT, HR, and Finance; Super Admin may add more, including from optional templates after reviewing suggested types. The Super Admin invites staff in that company, including role and handler eligibility. Invitees set their own passwords. There is no public employee signup. Super Admin configuration of request types and department templates is implemented on the Departments page. Approval decisions are implemented from the captured snapshot. Company-details screens remain planned. Settings is the account page. The Super Admin workspace dashboard, employee list, department list, limited company request oversight list, and Approvals inbox are implemented for that company. Super Admin cannot own requests. Handlers claim an opened unassigned request in their department. Super Admin detail/history is own submissions plus captured `SUPER_ADMIN` requests they did not submit.
- Deactivation blocks login and authenticated actions immediately. It is rejected while the account owns unfinished work.
- Advisory intake remains advisory. Creating a request still goes through the normal submit path. Intake may suggest a type from the company’s available types. It never chooses or overrides approval policy.

## Non-Functional Requirements

- Pages should load within a reasonable amount of time.
- Request status changes should become visible to employees without unnecessary delay.
- The system should prevent unauthorized access to requests and their information.
- The system should be available when employees and department staff need to submit, handle, or follow requests.
- A concurrent claim must leave exactly one owner.

Numeric limits for response time, concurrency, and availability are still unknown. See Unknowns.

## Assumptions

Confirmed rules live in the requirements above. They are not repeated here.

- IT, HR, and Finance are the default departments for a new company, not a rule that the company can have only those three. Super Admin may delete those defaults when they have no employees and no requests, and may add further departments, including from optional templates. Rationale: the problem statement introduces them with "such as," the Week 4 seed uses those names, and the confirmed signup default is those three, deletable.
- Email verification lasts 24 hours, and an invitation lasts 7 days, until a product decision says otherwise. Rationale: the links need a concrete lifetime to be enforceable. Resend and cancellation are not built. See ADR-003. Password reset lasts one hour; that lifetime is the implemented rule in ADR-004, not an open question.
- One email belongs to one company. Rationale: the existing unique email column already identifies a single account, and multiple-company membership is unresolved.
- Two companies may use the same name. Rationale: no uniqueness rule was confirmed, and the company id distinguishes workspaces.
- Existing development rows belong to one company named Development. Rationale: the migration has to keep those rows without inventing a second workspace or a password.

## Constraints

- The Week 4 API, schema, and UI stay as they are until a later feature implements a planned change.
- Historical weekly documents are not edited to match later decisions. A short pointer at the top of each weekly note may send a reader to this spec for current rules.

## Unknowns

These are not decided. Implementation must not pick an answer silently.

- Production email delivery. No provider is chosen, and no mailbox secret belongs in source or seed data. Until that decision exists, production signup, invitations, and password reset fail before creating a company, account, verification, invitation, or reset token. Local development on `operations_hub` logs the link. Tests read tokens only in-process or from a test-only file, not from a public HTTP route.
- Whether an invitation expires on a different schedule than the 7-day assumption, and whether it can be resent or cancelled.
- Whether one person may belong to more than one company. This slice keeps a single company per email.
- Whether company names must be unique. This slice allows duplicates.
- Which fields are required to submit a request, including whether title and description are mandatory. Week 4 stores both as optional. That implementation does not decide the full-product rule.
- Release and reassignment. Whether an owner can release a claim, and whether another eligible person can take over, are undecided. Super Admin cannot own or handle requests, so they are not a reassignment path. The effect on `IN_PROGRESS` work is undecided.
- Whether a Super Admin row that already has `canHandle=true` should be rewritten to false. Ownership and handling are already rejected for that role. Invitations store Super Admin `canHandle` as false; that is an implementation choice, not a second product rule.
- What to do if `currentOwnerId` already points at a Super Admin from earlier data. New assignment cannot create that state. Repair of existing rows is not decided.
- Whether employee department on the Super Admin oversight table is read live from `Employee.departmentId` (a founder Super Admin is null today) or stored on the request at submit time.
- Deployment hosting, including the production origin allowlist and cookie `SameSite` if the UI and API are served from different sites.
- What "company details" contains.
- Which attributes a request type has beyond its use in approval settings.
- Whether some request fields are confidential beyond the visibility rules above, especially for HR or Finance.
- What response time and availability are acceptable.

Week 1 left authentication, visibility, approval, ownership assignment, and statuses unknown. Those are now decided as planned product behavior, along with account provisioning, one role per account, handler eligibility, pending-approval visibility, denial, resubmission, and the initial deactivation rule. The unknowns in this section are the questions those decisions did not answer. Week 2–4 documents still describe the temporary `X-Actor-Id` slice and are unchanged.

## Non-Goals

- The system will not perform or resolve the actual work requested from departments. It supports submitting, approving when required, claiming, handling, and following those requests.
- Intake does not answer company-policy questions, approve requests, assign owners, submit requests on its own, or choose or override approval policy. It may suggest a request type only from the company’s available types.

## Acceptance Criteria

These criteria describe the planned full product. The implemented subset is Week 4 request handling, authentication, company signup, the Super Admin workspace, limited Super Admin request oversight, signup default departments, request types with a captured policy snapshot, optional department templates, approval decisions, and handler self-claim: create a request with a valid destination-department type, show it to the submitter or a handler, let an eligible handler claim an unassigned request in their department when approval is `NOT_REQUIRED` or `APPROVED`, move `SUBMITTED → IN_PROGRESS → COMPLETED` with history, sign in with email and password, and let a company Super Admin view dashboard counts, employees, departments, request types, and a limited company-wide request list for that company. Super Admin may submit and may open details/history for their own submissions. Super Admin cannot become current owner or act as a handler. Unrelated same-company `GET /requests/:id` and history are **403**; another company is **404**. The finished detail rule also includes eligible Super Admin approval-inbox requests. New companies start with IT, HR, and Finance; Super Admin may rename them or delete unused ones and may add departments from optional templates after reviewing suggested types. Employee and Department Admin sidebars, handler tabs, and My Requests are implemented. Super Admin manages departments and request types on Departments. Settings does not edit departments for Super Admin. A Department Admin renames only their own department from Settings > My Department. Unclaimed on the Super Admin list is not claimable.

### Positive Cases

- When an employee submits a request to a department, the request is created as `SUBMITTED` with no owner, and the approval policy in force for that department and request type (`NONE`, `DEPARTMENT_ADMIN`, or `SUPER_ADMIN`) is stored on the request. Which fields are required, including title and description, is still an open question.
- The submitter can see that request and its later work-status updates, including description and history.
- When the captured policy is `NONE`, an employee with handler eligibility, or a Department Admin by role, can claim an unassigned request in their department that they did not submit, and they become the only owner. Super Admin cannot claim or own.
- When the captured policy is `DEPARTMENT_ADMIN` or `SUPER_ADMIN`, the request is absent from the claimable queue. The submitter can still see it. The eligible approver (destination Department Admin, or a Super Admin who did not submit it) can approve it from the approval inbox. After approval, an eligible person in that department can claim it.
- A denial stores the required reason and an audit record of who decided and when. Work status stays unchanged, approval state becomes Denied, and the request cannot be claimed.
- Resubmission creates a new request. The denied request and its decision remain.
- The owner can move the request `SUBMITTED → IN_PROGRESS → COMPLETED`. Each successful change is saved and visible to the submitter.
- Two eligible people claiming the same request produce one owner.
- A founder can create a company workspace and, after verifying their email, sign in as that company’s Super Admin. That company starts with deletable IT, HR, and Finance. Super Admin may add further departments by free-text name, optionally from a template after reviewing suggested types, rename any department, and delete one that has no employees and no requests. They can create, rename, and edit request types and each type’s approval policy. They can invite a staff account. The invitee sets a password and can then sign in. The first Super Admin does not come from a setup command. Company-details screens and top-handler ranking remain planned. Dashboard, Staff, Departments, Approvals, and the company-wide Requests list in that company’s Super Admin workspace are implemented. Eligible handlers claim from Available on Requests; Super Admin does not.
- That Super Admin can see this company’s employee, department, and request counts, including Active requests as `SUBMITTED + IN_PROGRESS`. Request count cards open the matching filtered Requests list. They can list this company’s requests (all departments, including colleagues’ requests) on Requests, with combinable department, work-status, and assignment filters, and their own submissions on My Requests, with combinable approval, work-status, and assignment filters. Oversight columns are ID, Title, Submitter, Employee Department, Destination Department, and Work Status. Submitted At is not on that list. They can open details and history for requests they submitted. Unrelated rows do not open description or history. They have no assign, claim, or work-status actions. They can list this company’s employees with combinable name/email, department, role, handler-eligibility, and active filters. Approvals work. Departments is the company overview and the department editor. Settings is Profile, Security, Notifications, and Company. Request types for that Super Admin are edited on Departments.
- Changing an approval setting does not change the policy already stored on existing requests.
- A provisioned person who signs in with email and password can continue as that account. The session mechanism is implemented in ADR-002. Later actions use the account's current permissions from the database.
- Deactivating an account that owns no unfinished request blocks later login and authenticated actions, keeps history, and blocks new claims.

### Negative / Failure Cases

- A person cannot view a colleague's assigned request unless they submitted it, they are an eligible approver for it, or they are Super Admin looking at the limited oversight table (not the colleague’s description or history).
- A person cannot claim a request they submitted, a request outside their department, a request still waiting for approval, or a Denied request.
- A Super Admin cannot become current owner, including through `PATCH /requests/:id/owner`. A Super Admin cannot assign, claim, or change work status.
- An employee without handler eligibility cannot claim. A Department Admin can claim in their own department even when the stored flag is off. A Super Admin cannot claim even if that flag is on.
- An account cannot hold a second role.
- Public employee signup is rejected. Company signup is the onboarding path. After a company is active, only that company’s Super Admin can invite accounts, view the Super Admin dashboard, list employees with email, role, and active status, or list the company-wide oversight table. Employee and Department Admin callers are denied those Super Admin APIs. An invitation or verification link that is wrong, expired, or already used does not activate an account. A caller cannot read or change another company’s requests, history, employees, departments, dashboard counts, request lists, or intake departments by sending that company’s ids. The retired setup command does not create a Super Admin.
- The submitter cannot approve or deny their own request. When the only Super Admin submitted a `SUPER_ADMIN` request, the system does not fall back to self-approval.
- A denial without a reason is rejected, and no approval decision is stored.
- Deactivation is rejected while the account owns a request that is not `COMPLETED`.
- A deactivated account cannot sign in, call authenticated actions, or claim.
- A failed status update is not shown as a successful change and does not append a successful history record.
- Once a required submission field is defined, omitting it prevents the request from being created. Title and description are not treated as mandatory until that question is decided.
- An unauthenticated caller, or a caller whose role does not allow the action, is denied. The UI cannot grant that action by sending a different identity header.
- Intake cannot choose or override approval policy. It may suggest only a type that already exists in the caller’s company.
