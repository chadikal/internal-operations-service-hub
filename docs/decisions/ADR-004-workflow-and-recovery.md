# ADR-004: Request workflow, visibility, and account recovery

Status: **implemented** on `feature/full-product-foundation`. This decision records behavior that is already in the code. It does not rewrite ADR-001, ADR-002, ADR-003, or the Week 2–4 notes. ADR-001 still holds: submission is synchronous, and approval does not block storing the request. ADR-003 still holds for company signup and the company boundary. Where an older sentence in those files says Settings, approvals, or password reset are unbuilt, this ADR is the current record.

## Context

The product needed a way to show people only the requests they may act on, to keep approval separate from work status, to give Super Admin a place to manage departments without turning the Departments page into an editor, and to finish signup and invitation when no production mailbox exists.

## Decision

### Request visibility

Lists and detail use the same company boundary. Another company’s id is **404**. An unrelated id in the same company is **403**.

- **My Requests** is `queue=submitted`: requests that signed-in person submitted, including another department and including waiting or denied approval. Work Status (`SUBMITTED`, `IN_PROGRESS`, `COMPLETED`) and Claim Status (`unclaimed` when `currentOwnerId` is null, `claimed` when an owner is set) filter that list only. Claim status on any other queue is **400**. Approval Status can be Not required, Pending, Approved, or Denied. All approval states leaves the filter off, so older rows whose approval state is null stay in the list. The dropdown does not offer a separate empty-state choice. Request details still open those rows and show an em dash when no approval state is stored.
- **Available** is `queue=available`: unassigned requests in the viewer’s department that they did not submit, that they may claim now. Handler eligibility is required. A required captured policy is included only after `APPROVED`.
- **Claimed by Me** is `queue=claimed`: requests that person owns whose work status is `SUBMITTED` or `IN_PROGRESS`. This is the list of requests they claimed. It is a tab on Requests, not a separate page.
- **Completed** is `queue=completed`: requests that person owns whose work status is `COMPLETED`.
- **Department** is `queue=department`: Department Admin only. Captured `DEPARTMENT_ADMIN` requests whose destination is that admin’s department and that they did not submit.
- **Approvals** is the inbox for a decision the caller may make. A Department Admin sees captured `DEPARTMENT_ADMIN` requests in their department that they did not submit. A Super Admin sees captured `SUPER_ADMIN` requests in their company that they did not submit.
- **Super Admin Requests** is the limited company oversight table: ID, submitter name, title, submitter department, destination department, work status, and whether the row is theirs. It does not return description or approval state. Opening a row shows detail only when that Super Admin submitted it. Unrelated oversight rows do not.

`GET /requests/:id` and history succeed for the submitter, an eligible handler who owns the request or can claim it now, or an active Department Admin or Super Admin who can decide it under the captured policy. A handler who already owns legacy work can still open it. A Super Admin who does not own it and cannot decide it receives **403**.

### Approval versus work status

Work status stays `SUBMITTED`, `IN_PROGRESS`, `COMPLETED`. Approval state stays `NOT_REQUIRED`, `PENDING`, `APPROVED`, or `DENIED`, or null on older rows. A decision does not change work status. Denial stores a reason and blocks claim and transition. Resubmission is a new request. The submitter cannot decide their own request. If no other eligible admin exists, the request stays pending. The UI derives labels such as Awaiting approval, Denied, Claimed, and Completed from those stored fields. It does not store a display status.

### Departments and Settings

Super Admin **Departments** is an overview for that company: name, member count (including inactive members), Department Admin names (including inactive admins, or none), destination-request count, and awaiting-approval count. Awaiting approval is `PENDING`, or a null approval state whose captured policy is `DEPARTMENT_ADMIN` or `SUPER_ADMIN`.

Super Admin manages the company’s department structure on the **Departments** page: creating, renaming, and deleting departments, reviewing templates, and editing request types. **Settings** is Profile, Security, and Notifications for every role. Super Admin also has a read-only Company section and does not edit departments there. A Department Admin maintains only their own department from Settings > My Department, which can rename that department and lists its request types as read-only. They cannot create, delete, or deactivate departments, cannot edit another department, and cannot edit request types or request-type rules. `PATCH /departments/:id` allows a Super Admin to rename any department in their company, and a Department Admin to rename only `departmentId` on their account. Another department in the same company is **403**. A department id outside the company is **404**, the same as a Super Admin foreign id. Create, delete, templates, and request-type routes stay Super Admin-only. Handler and Employee settings stop at Profile, Security, and Notifications. A password change from Settings emails the existing reset link. Company-details editing is not built. Department Admin is a handler in their own department by role, even when `canHandle` is false. Inviting or assigning Department Admin stores `canHandle` true. Super Admin still cannot claim or own requests. Staff removal sets `active` false, revokes open sessions, and retires unused invitations. It does not delete the account or request history, and it is refused while that account owns unfinished work or is the last active Super Admin. A Department Admin can invite, edit, and remove only employees in their own department.

### Onboarding

ADR-003 remains the onboarding decision: a founder verifies email before the company is active, invitees set their own password, and there is no public employee signup. The Departments page is where that Super Admin reviews the company overview and edits departments and request types. Settings is the account page.

### Mail and password reset

There is no production mail provider. Signup, invitations, and password reset call the same delivery check before they write records. When that check fails, the API returns **503** and creates nothing. That includes an unknown email: the generic acknowledgement is returned only when delivery is allowed.

Delivery is allowed in two cases only:

- `NODE_ENV` is exactly `development` and the database name is exactly `operations_hub`. The API prints the verification, invitation, or reset link in the API terminal. It does not write a token file.
- `NODE_ENV` is exactly `test` and the database name is exactly `operations_hub_test`. Tests read the token from the in-process outbox, or from the file named by `TEST_EMAIL_OUTBOX`. There is no HTTP route that returns a token.

No other database or environment logs the link or writes a token file.

When delivery is allowed, `POST /auth/forgot-password` always returns the same acknowledgement: `If an account exists for that email, a reset link has been sent.` It does not say whether the email exists. A link is sent only for an active account that already has a password and whose company is `ACTIVE`. An unknown address, an address that fails email checks, an inactive account, an account with no password, and a company that is not `ACTIVE` get the same acknowledgement and no token.

The reset link expires after **one hour**. It is stored only as a SHA-256 hash. Using it sets a new password of at least 12 characters and revokes that account’s open sessions. A second use is rejected. Requesting another link marks older unused links for that account as used before the new link is stored. The HTTP response does not contain the token. The UI asks the person to type the new password twice; the API accepts one password.

### Request detail

My Requests, handler queues, Department Admin Requests, and Approvals open the same centered overlay. The card shows the title once, the derived stage, request type, destination, submitter, submitted time, captured approval policy, approval state once, approval notice and decision when present, work status, owner, description, the actions that role may take, and status history in that same card. Those pages use one table: the same row height, two-line titles, readable submitter and date, and an empty state that is a row in the table. Shared headings are ID, Title, Submitter, Employee Department, Destination Department, and Submitted At, in that order, and only when that list’s API returns the field. Oversight ends with Work Status and does not show Submitted At. My Requests, Available, Claimed by Me, Completed, and the Department Admin department list end with Request Stage and do not show Employee Department, because those queues do not return the submitter’s department. Approvals ends with Approval Status and does not show Employee Department. A table title is limited to two lines, and the overlay shows the full title and description. An empty list stays a table row. Super Admin oversight still opens that card only for a row that Super Admin submitted. Unrelated oversight rows stay on the table and do not show description or history. Handler claim, start, and complete stay in the overlay and follow the existing rules.

### Sidebar and login landing

Every role’s sidebar uses this order and omits pages that role cannot open: Dashboard, Requests, My Requests, Approvals, Staff, Departments, Settings. The navigation item and page heading are Staff. The route stays `/employees`.

- Super Admin: all seven.
- Department Admin: Dashboard, Requests, My Requests, Approvals, Staff, Settings. No Departments page.
- Employee: Dashboard, My Requests, Settings. Requests is included only when `canHandle` is true. No Approvals, Staff, or Departments.

A new login opens that role’s Dashboard (`/admin` for Super Admin, `/` for everyone else), including after logout from another page. Refreshing an existing session keeps the current route.

### Dashboard counts

Cards show a total on the left and a breakdown on the right. A figure is a link only when the destination list is that exact authorized set. Work-status figures and approval-state figures are independent. The cards do not carry explanatory paragraphs. Breakdown labels wrap, and the number stays on the same row. A card grows to fit that text at desktop and narrow widths. The full-width Requests card uses two breakdown columns from 800px up. Other cards keep one column so a half-width card does not clip a label or cover a number.

**Super Admin** (`GET /admin/dashboard`), company scope, plus My Requests for that account only:

- **Requests.** Total is every company request. Submitted, in progress, and completed partition that total by work status. Claimed is `currentOwnerId` set. Unclaimed is no owner. Claimed and unclaimed also partition the total, and they overlap the work-status figures: a claimed request can still be `SUBMITTED`. Active is submitted plus in progress, so it overlaps those two and is not added to completed. Each of these opens the company Requests list with the matching work-status or assignment filter.
- **Approvals.** The card and the Approvals page are the same set: requests submitted by someone else that this Super Admin is eligible to decide. That is captured policy `SUPER_ADMIN` in the company, excluding this admin’s own submissions. Awaiting, Approved, and Denied use the required-approval buckets inside that set. Awaiting is `PENDING`, or a null approval state with that captured policy. Approved and Denied are those states inside the required-approval set. Those three add up to the approvals total. The total opens Approvals with `status=all`. Awaiting, Approved, and Denied open the same list with that status. Awaiting is the default, including the sidebar link. There is no separate “Waiting for your decision” filter. Own submissions stay on My Requests. This admin still cannot approve their own request.
- **Staff.** The section is labeled Staff. Total is every employee in the company, active and inactive. Admins are `SUPER_ADMIN` or `DEPARTMENT_ADMIN`. Employees are role `EMPLOYEE`. Admins and employees partition the total. Handlers are `canHandle=true`, including inactive people, and overlap admins and employees. A Department Admin who can handle work is one person in the total, one admin, and one handler. Handlers are not added to the total. The total opens Staff. Admins opens Staff with `role=ADMIN`, which is Super Admin or Department Admin. Handlers opens Staff with `canHandle=true`. Employees opens Staff with role `EMPLOYEE`. The role filter is All, Admins, Employee, Department Admin, and Super Admin. Handler eligibility is a separate All, Handlers, and Non-handlers filter because `canHandle` can overlap either role. Staff and Departments share one full-width panel. Staff uses most of that width. On a narrow screen, Departments stacks under Staff.
- **Departments.** The company department count, shown as a compact separated section on the right of the Staff panel. It opens the overview. It has no extra figures.
- **My Requests.** Only requests that Super Admin submitted. Total opens My Requests. Submitted, in progress, and completed partition that total by work status and open My Requests filtered to that work status. Unclaimed is their submissions with no owner. It overlaps those work-status figures and opens My Requests with Claim Status set to Unclaimed. The page also offers Claimed, which is an owner present, and All. Claim status stays limited to that person’s submissions. Super Admin does not see awaiting, approved, or denied on this card.

**Department Admin** (`GET /department/dashboard`): Requests counts every request whose destination is that department. Submitted, in progress, completed, claimed, unclaimed, and active use the same definitions as the company Requests card. Each figure, including the total, opens All requests on the department Requests page (`GET /department/requests`) with that filter: work status `SUBMITTED`, `IN_PROGRESS`, `COMPLETED`, or `ACTIVE`, or assignment `unassigned` (Unclaimed) or `assigned` (Claimed). The list stays inside the department. It does not return the description. A row opens the existing detail only when `canOpen` is true, which uses the same view rule as `GET /requests/:id`. When this admin can handle work, Available, Claimed by Me, and Completed stay as separate tabs. Approvals are captured `DEPARTMENT_ADMIN` requests in that department submitted by someone else. The dashboard Awaiting count and `status=awaiting` are that same set. All, Approved, and Denied are the eligible history. Own submissions stay on My Requests. This admin cannot approve their own request. Staff counts people in the department. Department Admin is role `DEPARTMENT_ADMIN` and opens Staff with `role=DEPARTMENT_ADMIN`. Employees opens role `EMPLOYEE`. Handlers opens `canHandle=true`. The role filter is All, Department Admin, and Employee. Super Admin and the combined Admins option are not on this page. Handler eligibility stays All, Handlers, and Non-handlers, because `canHandle` can overlap either role. A Department Admin who can handle work is one person in the total, one Department Admin, and one handler. A Super Admin assigned to the department stays in the total and is not in those two role figures. My Requests is still only what this admin submitted, with Submitted, In Progress, Completed, and Unclaimed. The page still filters approval state. The card does not show personal approval figures.

**Employees and handlers** (`GET /requests/summary`): My Requests for that person shows the total plus Submitted, In Progress, Completed, and Unclaimed. Submitted, in progress, and completed open My Requests filtered to that work status. Unclaimed opens Claim Status Unclaimed and overlaps those three. The page still filters approval state. The card does not show personal approval figures. A handler who is not a Department Admin also sees Requests: Available, Claimed by Me, and Completed. The total opens Requests on the Available tab. Those three do not overlap, and each opens that Requests tab. They do not see company or department Requests, Approvals, Staff, or Departments cards.

## Reasoning

- Separate queues stop a handler list from becoming a company-wide body view. Super Admin oversight stays a summary so unrelated descriptions are not exposed.
- Approval and work status answer different questions. Mixing them would make a denial look like completed work, or let a claim skip a required decision.
- An overview table and a settings editor are different jobs. Putting creation and deletion on the overview made the department list a form.
- A generic reset acknowledgement avoids telling a caller which emails are registered. Checking mail first means a missing provider cannot be distinguished from a missing account by status code alone when delivery is down: everyone receives **503**.
- One hour limits how long a leaked reset link works. Revoking sessions means the previous password’s cookie cannot keep working. Retiring older unused links means only the latest email can reset the account.

## Consequences

- Production signup, invitations, and password reset fail until a mail provider is chosen. That is not production onboarding.
- Local development on `operations_hub` can complete verification, invitation, and reset by opening the printed link.
- Claimed by Me is not a second product list beyond the owner’s unfinished requests.
- The only-Super-Admin `SUPER_ADMIN` submission stays pending. What else should happen is still an open product question. The code does not approve it automatically.

## Still open

These are not decided by this ADR:

- Which mail provider to use in production.
- Whether invitation lifetime, resend, or cancellation should differ from the seven-day assumption in ADR-003.
- Whether one person may belong to more than one company, and whether company names must be unique.
- Whether title and description are required.
- Release and reassignment.
- Whether a Super Admin who already has `canHandle=true`, or who already owns a request, should be repaired.
- Whether the oversight table should snapshot the submitter’s department.
- What company details contain, and any request-type attributes beyond name and approval policy.
- Confidentiality beyond the visibility rules above.
- Deployment hosting.
- What should happen when the only Super Admin submits a `SUPER_ADMIN` request, beyond leaving it pending.
- The unfinished-work check that should reject deactivation. Login already rejects an inactive account. The ownership check and a deactivation screen are not built.
