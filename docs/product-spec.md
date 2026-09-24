# Internal Operations Service Hub

A company-internal system for requesting and tracking help from departments such as IT, HR, and Finance.

This specification records the product. Weekly delivery notes (`docs/week2-agentic-workflow.md`, `docs/week3-agentic-workflow.md`, `docs/week3-full-stack-delivery.md`, `docs/week4-production-ai.md`) stay historical records of what those slices implemented. Later decisions do not rewrite them.

## Problem / Context

Employees request help from departments such as IT, HR, and Finance through messy channels.

This leads to forgotten requests, requests being sent to the wrong person, and unclear ownership, status, and approval.

## Known Facts

- Employees currently ask for help through messy channels.
- Requests get forgotten.
- Requests get sent to the wrong person.
- Request ownership, status, and approval are unclear.
- The company wants one system to submit, handle, and follow requests.

## Implemented through Week 4, plus authentication and company signup

The running system is the Week 4 request and intake behavior, email/password sessions from ADR-002, and company signup from ADR-003. Weekly notes under `docs/week4-*` still describe the older `X-Actor-Id` slice and were not rewritten.

- A founder creates a company workspace with company name, their name, email, and password. The workspace and that Super Admin stay inactive until the email is verified. There is no public employee signup and no “working alone or in a team” question.
- After verification, that Super Admin can add a department in the company and invite staff. Invitees set their own passwords. The first-Super-Admin command is not the onboarding path and does not create an account.
- Sign-in is email and password. The UI has a login form and logout. There is no Acting-as switcher.
- Protected routes use the `hub_session` cookie. `X-Actor-Id` is ignored. `submittedBy` and `changedBy` must match the signed-in account.
- Every account, department, request, status-history row, and session belongs to one company. A caller cannot read or change another company’s data by sending its ids.
- Seeded people are still Chadi (`canHandle=true`) and John (`canHandle=false`), now in the migrated Development company. A handler may be assigned as owner through `PATCH /requests/:id/owner`. The owner cannot be the submitter. A Super Admin without `canHandle` cannot assign or transition.
- Visibility inside the caller’s company is `canHandle` or "I submitted this request." Role is stored and returned by `GET /auth/me`. It does not yet grant an approval inbox. Super Admin does not yet see every request in the company, and never sees another company’s requests.
- Work status is `SUBMITTED → IN_PROGRESS → COMPLETED`. `COMPLETED` is terminal. A current owner is required before a transition. Successful transitions append status history.
- Optional `title` and `description` exist. There are no request types, approval records, or admin management screens. Adding a department and inviting staff are the onboarding actions, not those screens.
- Advisory intake can suggest troubleshooting and a draft from the caller’s own departments. It does not create or change a request. The employee submits through the existing create path.
- Departments in the Development company seed are IT, HR, and Finance. Existing employee rows keep their ids. Email and password hash stay empty until credentials are set, so those rows cannot log in yet.

## Confirmed full-product requirements (planned)

These decisions are confirmed for later implementation. Login, company signup, and company-scoped invitations from ADR-002 and ADR-003 are implemented. Claiming, approvals, admin screens, and password reset are not.

### Authentication

People sign in with email and password. There is no public employee signup. A founder creates a company and becomes its first Super Admin after email verification. That Super Admin invites later accounts in the same company, and those people set their own passwords. Company signup and invitations are implemented and recorded in `docs/decisions/ADR-003-company-signup.md`. Session behavior from ADR-002 remains.

The backend verifies identity and enforces permissions. The UI is not the source of identity or authorization.

Cookie sessions, eight-hour absolute expiry, 30-minute idle expiry, revocable sessions, CSRF, Origin checks, and the initial rate limits are implemented. Login admission counts in-flight attempts, and a failed activity timestamp does not turn an already-committed change into an error. The UI clears account-specific data when the session ends or the account changes, and it ignores a late response from the previous session. Password reset and deployment hosting remain unresolved. Claiming, the approval inbox, and admin screens are still planned, not built.

### Roles

Each account has one role:

- Employee
- Department Admin
- Super Admin

Handler eligibility is a separate permission, not a role. Super Admin grants or removes it. An Employee, Department Admin, or Super Admin may claim only when that permission is on, only for requests in their own department, and never for a request they submitted.

### Visibility

- Every person sees the requests they submitted, including requests that are waiting for approval or Denied.
- **Claimable queue:** eligible unassigned requests in the viewer's department. A request is on this queue only when it has no owner, the viewer has handler eligibility, it is in their department, and they did not submit it. A request that requires approval joins this queue only after approval. A request that is waiting for approval, or Denied, is not on this queue. Denial never puts it there.
- **Assigned to me:** requests the viewer personally owns. This list is separate from the claimable queue.
- Requests assigned to colleagues are on neither list.
- A request that is waiting for approval stays visible to its submitter, to authorized approvers in the approval inbox, and to Super Admin.
- Super Admin sees all requests in their own company. This inbox is still planned. The running rule is the temporary `canHandle` or submitter check, limited to that company. Another company’s requests are not visible.

### Claiming

People with handler eligibility claim from the claimable queue themselves. Administrators do not assign an owner by hand. The claimer cannot be the submitter, and the request must be in their department. A request that requires approval can be claimed only after it is approved. Pending-approval and Denied requests cannot be claimed. Denial never unlocks claiming. If two eligible people claim the same request at the same time, exactly one of them becomes the owner.

A deactivated account cannot claim.

### Approval

Whether approval is required is configurable per department and request type. The value in force when a request is created is stored on that request. Later changes to the rule apply to new requests only.

When the captured requirement says approval is required, the destination Department Admin or a Super Admin approves or denies the request before anyone may claim it. Department Admins have a separate approval inbox for that work.

The submitter cannot approve or deny their own request. Denial requires a reason. Each decision is audited.

Denial leaves work status unchanged and sets approval state to Denied. The original decision stays on that request. Resubmission creates a new request.

Approval state is separate from work status. Work status stays `SUBMITTED → IN_PROGRESS → COMPLETED`.

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
- Department Admins, who approve or deny requests for their department when approval is required. With handler eligibility, they may also claim in that same department, except their own submissions.
- Super Admin, who sees every request in their own company, invites accounts in that company, and manages the configuration above for that company only. With handler eligibility, Super Admin may claim only in their own department, and never their own submissions. A Super Admin has no access to another company.

Department staff from the original problem (HR, IT, Finance) are accounts in these roles, not a separate kind of account.

### Stakeholders

- Employees
- HR, IT, and Finance departments
- Super Admin, for configuration of their own company

## Functional Requirements

- Employees can submit help requests to a department.
- The system shows who currently owns a request when someone has claimed it.
- Employees can view their submitted requests and the current work status.
- Accounts with handler eligibility claim claimable unassigned requests in their department and update work status on requests they own.
- Department Admins review a separate approval inbox when the captured rule requires approval. Pending-approval requests are not in the claimable queue.
- A denial keeps the current work status, records Denied, and leaves that request unclaimable. A later submission is a new request.
- A founder creates a company workspace and verifies their email before that workspace or Super Admin account is active. The Super Admin invites staff in that company, including role and handler eligibility. Invitees set their own passwords. There is no public employee signup. Super Admin configuration of request types, approval settings, and company details remains planned. Adding a department in the company is implemented so invitations have a department to join.
- Deactivation blocks login and authenticated actions immediately. It is rejected while the account owns unfinished work.
- Advisory intake remains advisory. Creating a request still goes through the normal submit path.

## Non-Functional Requirements

- Pages should load within a reasonable amount of time.
- Request status changes should become visible to employees without unnecessary delay.
- The system should prevent unauthorized access to requests and their information.
- The system should be available when employees and department staff need to submit, handle, or follow requests.
- A concurrent claim must leave exactly one owner.

Numeric limits for response time, concurrency, and availability are still unknown. See Unknowns.

## Assumptions

Confirmed rules live in the requirements above. They are not repeated here.

- IT, HR, and Finance are representative department names, not a rule that the company can have only those three. Rationale: the problem statement introduces them with "such as," and the Week 4 seed uses those names. Super Admin management of the department list is already a confirmed requirement.
- Email verification lasts 24 hours, and an invitation lasts 7 days, until a product decision says otherwise. Rationale: the links need a concrete lifetime to be enforceable. Resend and cancellation are not built. See ADR-003.
- One email belongs to one company. Rationale: the existing unique email column already identifies a single account, and multiple-company membership is unresolved.
- Two companies may use the same name. Rationale: no uniqueness rule was confirmed, and the company id distinguishes workspaces.
- Existing development rows belong to one company named Development. Rationale: the migration has to keep those rows without inventing a second workspace or a password.

## Constraints

- The Week 4 API, schema, and UI stay as they are until a later feature implements a planned change.
- Historical weekly documents are not edited to match later decisions.

## Unknowns

These are not decided. Implementation must not pick an answer silently.

- Production email delivery. No provider is chosen, and no mailbox secret belongs in source or seed data. Until that decision exists, production signup and invitations fail before creating a company, account, verification, or invitation. Local development on `operations_hub` logs the link. Tests read tokens only in-process or from a test-only file, not from a public HTTP route.
- Whether an invitation expires on a different schedule than the 7-day assumption, and whether it can be resent or cancelled.
- Whether one person may belong to more than one company. This slice keeps a single company per email.
- Whether company names must be unique. This slice allows duplicates.
- Which fields are required to submit a request, including whether title and description are mandatory. Week 4 stores both as optional. That implementation does not decide the full-product rule.
- Release and reassignment. Whether an owner can release a claim, whether another eligible person can take over, and whether Super Admin can move ownership are undecided. The effect on `IN_PROGRESS` work is undecided.
- Password reset.
- Deployment hosting, including the production origin allowlist and cookie `SameSite` if the UI and API are served from different sites.
- What "company details" contains.
- Which attributes a request type has beyond its use in approval settings.
- Whether some request fields are confidential beyond the visibility rules above, especially for HR or Finance.
- What response time and availability are acceptable.

Week 1 left authentication, visibility, approval, ownership assignment, and statuses unknown. Those are now decided as planned product behavior, along with account provisioning, one role per account, handler eligibility, pending-approval visibility, denial, resubmission, and the initial deactivation rule. The unknowns in this section are the questions those decisions did not answer. Week 2–4 documents still describe the temporary `X-Actor-Id` slice and are unchanged.

## Non-Goals

- The system will not perform or resolve the actual work requested from departments. It supports submitting, approving when required, claiming, handling, and following those requests.
- Intake does not answer company-policy questions, approve requests, assign owners, or submit requests on its own.

## Acceptance Criteria

These criteria describe the planned full product. The implemented subset is Week 4 request handling plus the first authentication slice: create a request, show it to the submitter or a handler, assign an owner through the current API, move `SUBMITTED → IN_PROGRESS → COMPLETED` with history, and sign in with email and password. The claim, approval, and admin-screen criteria are not implemented.

### Positive Cases

- When an employee submits a request to a department, the request is created as `SUBMITTED` with no owner, and the approval requirement in force for that department and request type is stored on the request. Which fields are required, including title and description, is still an open question.
- The submitter can see that request and its later work-status updates.
- When approval is not required, an account with handler eligibility can claim an unassigned request in their department that they did not submit, and they become the only owner.
- When approval is required, the request is absent from the claimable queue. The submitter can still see it. A destination Department Admin or a Super Admin can approve it from the approval inbox. After approval, an eligible person in that department can claim it.
- A denial stores the required reason and an audit record of who decided and when. Work status stays unchanged, approval state becomes Denied, and the request cannot be claimed.
- Resubmission creates a new request. The denied request and its decision remain.
- The owner can move the request `SUBMITTED → IN_PROGRESS → COMPLETED`. Each successful change is saved and visible to the submitter.
- Two eligible people claiming the same request produce one owner.
- A founder can create a company workspace and, after verifying their email, sign in as that company’s Super Admin. They can add a department and invite a staff account. The invitee sets a password and can then sign in. The first Super Admin does not come from a setup command. Request types, approval settings, company-details screens, and a full admin screen remain planned.
- Changing an approval setting does not change the requirement already stored on existing requests.
- A provisioned person who signs in with email and password can continue as that account. The session mechanism is implemented in ADR-002. Later actions use the account's current permissions from the database.
- Deactivating an account that owns no unfinished request blocks later login and authenticated actions, keeps history, and blocks new claims.

### Negative / Failure Cases

- A person cannot view a colleague's assigned request unless they are Super Admin or they submitted it.
- A person cannot claim a request they submitted, a request outside their department, a request still waiting for approval, or a Denied request.
- An account without handler eligibility cannot claim, including a Department Admin or Super Admin.
- An account cannot hold a second role.
- Public employee signup is rejected. Company signup is the onboarding path. After a company is active, only that company’s Super Admin can invite accounts. Employee and Department Admin callers are denied. An invitation or verification link that is wrong, expired, or already used does not activate an account. A caller cannot read or change another company’s requests, history, employees, departments, or intake departments by sending that company’s ids. The retired setup command does not create a Super Admin.
- The submitter cannot approve or deny their own request.
- A denial without a reason is rejected, and no approval decision is stored.
- Deactivation is rejected while the account owns a request that is not `COMPLETED`.
- A deactivated account cannot sign in, call authenticated actions, or claim.
- A failed status update is not shown as a successful change and does not append a successful history record.
- Once a required submission field is defined, omitting it prevents the request from being created. Title and description are not treated as mandatory until that question is decided.
- An unauthenticated caller, or a caller whose role does not allow the action, is denied. The UI cannot grant that action by sending a different identity header.
