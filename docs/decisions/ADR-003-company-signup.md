# ADR-003: Company signup and company-scoped access

Status: **implemented** on `feature/full-product-foundation`. This decision replaces the first-Super-Admin command as the normal onboarding path. It does not rewrite ADR-002 or the weekly notes. The Super Admin workspace (dashboard, employees, the department overview, Settings, the company request list, and Approvals) is implemented for that company. Handler self-claim from the Requests tabs is implemented. Password reset is recorded in ADR-004: a one-hour, single-use link, the same acknowledgement for an unknown email when mail can be sent, and revocation of that account’s open sessions. Deployment hosting remains unresolved in `docs/product-spec.md`.

**25 September 2026 — current product, not a rewrite of this slice.** Signup creates a `PENDING` company and the founder’s confirmed departments and request types in the same transaction. The wizard defaults are ordinary IT, HR, and Finance with their catalog types. A signup that omits the list still creates those three with no types. Super Admin may still add departments with free-text `POST /departments`, optionally `templateId` and confirmed `requestTypes`, rename with `PATCH /departments/:id`, and delete unused ones with `DELETE /departments/:id`. Occupied departments return **409**. Existing companies are not backfilled. Super Admin manages request types from the Departments page (`POST /departments/:id/request-types`, `PATCH /request-types/:id`) and may preview templates (`GET /department-templates`) then apply confirmed types (`POST /departments/:id/template-types`). The Departments page is the overview and that editor. Settings is the account page. A signup that omits departments does not create types. Optional templates (IT, HR, Finance, Operations, Marketing, Facilities, Custom/Empty) keep the display name independent of the template; Super Admin reviews suggested types and policies before they apply. The catalog in `docs/product-spec.md` is a recommendation. Signup does not auto-apply types. Approval decisions that use the captured snapshot are implemented in a later pass and are not part of signup.

A later pass added a company-wide Requests list. `GET /admin/requests` is Super Admin-only and scoped to the caller’s company. **Implemented (25 September 2026 oversight slice):** that list returns ID, submitter name, title, submitter department, destination department, status, and `mine`. **Implemented (26 September 2026 approval slice):** `GET /requests/:id` and history also return full detail for captured `SUPER_ADMIN` requests that Super Admin did not submit. Unrelated same-company ids stay **403**. Another company’s id stays **404**. `GET /requests/approvals` and `POST /requests/:id/approval` record one decision. Pending and denied requests cannot be claimed or transitioned. **Implemented (26 September 2026 self-claim):** an eligible handler claims an unassigned request in their department with `POST /requests/:id/claim` when approval is `NOT_REQUIRED` or `APPROVED`, or when the approval state is null and the captured policy is null or `NONE`. A required captured policy with a null state waits for approval. The claim sets the owner and leaves work status `SUBMITTED`. `PATCH /requests/:id/owner` is blocked. Super Admin cannot become current owner and cannot claim or transition. When approvals exist they may approve or deny a request whose captured policy is `SUPER_ADMIN` except a request they submitted; that is not handling. Self-approval is never an implicit fallback. Other roles keep the temporary `canHandle` or submitter rule and cannot call the company-wide list. Unclaimed on this list is not claimable. Eligible handlers claim from Available on Requests. That list is not a claim button on this oversight table.

## Decision

A founder creates one company workspace with a company name, their name, their email, and a password. The workspace and that first Super Admin account stay inactive until the founder verifies the email. The create-workspace wizard starts from IT, HR, and Finance and their catalog request types; signup stores the confirmed list. A signup that omits the list still inserts ordinary IT, HR, and Finance with no types. After verification, the Super Admin can add, rename, or delete unused departments in that company and invite staff. Invitees set their own passwords. There is no public employee signup and no question about working alone or in a team.

Super Admin authority is limited to that company. Accounts, departments, requests, sessions, status history, invitations, and email verifications carry a company boundary. Backend queries and authorization include that boundary on request, history, lookup, and AI intake routes. A caller in company A cannot read or change company B’s data by sending B’s ids.

A later pass added a company-wide Requests list for that Super Admin. `GET /admin/requests` is Super Admin-only and scoped to the caller’s company. Opening a row uses `GET /requests/:id` and `GET /requests/:id/history`; a Super Admin in that company can view those without `canHandle`. They may submit. They cannot become current owner, including through `PATCH /requests/:id/owner`, and they cannot assign, claim, or transition. When approvals exist they may approve or deny, which is not handling. Another company’s request id still returns **404**. Other roles keep the temporary `canHandle` or submitter rule and cannot call the company-wide list. Unclaimed on this list is not claimable. Eligible handlers claim an opened request; `PATCH /requests/:id/owner` does not assign another person.

That later-pass paragraph records the first Requests list. Current detail access is the 26 September rule in the status note above and in ADR-004: own submissions plus captured `SUPER_ADMIN` requests that Super Admin did not submit. Unrelated same-company detail stays **403**.

## Migration plan

Do not reset `operations_hub` or `operations_hub_test`. Add a migration that:

1. Creates `Company` with `name` and `status` (`PENDING` or `ACTIVE`). Company name is not unique.
2. Inserts one **Development** company with status `ACTIVE`.
3. Adds a required `companyId` to `Department`, `Employee`, `Request`, `RequestStatusHistory`, and `Session`, and backfills every existing row to that Development company.
4. Leaves employee ids, department ids, request ids, history ids, names, `canHandle`, emails, password hashes, roles, and active flags unchanged. It does not invent a password.
5. Makes `Employee.departmentId` nullable so a founder is not placed in a department the signup form does not collect. Existing employees keep their departments.
6. Adds `EmailVerification` and `Invitation`. Tokens are stored only as SHA-256 hashes.

A scratch-database test applies the earlier migrations, inserts an employee, request, history row, and session, applies this migration, and reads those rows back with the same ids attached to the single Development company.

## Implementation stages

1. **Company boundary.** Schema, migration, and company filters on request create/read/update, history, employee and department lookups, and intake department lists.
2. **Signup and email verification.** `POST /auth/signup` creates a `PENDING` company and an inactive Super Admin. `POST /auth/verify-email` activates both. Login before verification stays the generic **401**.
3. **Invitations and password setup.** `POST /departments` and `POST /auth/invitations` are company Super Admin actions. `POST /auth/invitations/accept` sets the invitee’s password. `POST /auth/accounts` is removed. The first-Super-Admin command no longer inserts an account.
4. **Frontend.** Company signup, email verification, department creation, staff invite, and invitee password setup. No employee registration form.

Argon2id, HS256 cookie sessions, CSRF, Origin checks, eight-hour absolute expiry, 30-minute idle expiry, revocation, and login throttling stay as ADR-002 implemented them. Signup, verification, and invitation acceptance are public and use the same Origin allowlist as login. They do not set a session. Creating a department or an invitation counts as session activity.

## Assumptions

These are implementation choices, not confirmed product rules. Change them when the product decision is made.

- Email verification links expire after **24 hours**.
- Invitation links expire after **7 days**. There is no resend.
- A person belongs to **one company**. `Employee.email` stays globally unique, so the same email cannot join a second company.
- **Duplicate company names are allowed.** The company id is the identity.
- The migrated workspace is named **Development** and is `ACTIVE`.
- The founder’s `departmentId` is null. Staff invitations require a department in that company, so the Super Admin can `POST /departments` before inviting. **Superseded for the screen:** department creation, deletion, templates, and request-type editing are on the Super Admin Departments page. Super Admin also renames any department there. A Department Admin may rename only their own department from Settings > My Department (`PATCH /departments/:id`). Settings is Profile, Security, Notifications, and Company for Super Admin, plus My Department for Department Admin. Create, delete, and request-type routes stay Super Admin-only.
- Verification and acceptance do not sign the person in.
- An invitation reserves the email by creating an inactive account with no password hash. Acceptance sets the hash and `active=true`.
- A Super Admin may invite Employee, Department Admin, or Super Admin. The new Super Admin is scoped to the same company and does not gain access to other companies.
- Cross-company request and history ids use the same **404** as a missing id. Cross-company employee and department ids use the same **400** as an unknown id. The response does not include the other company’s data.
- Links use the first `AUTH_ORIGINS` entry, or `http://localhost:5173` when that list is empty.
- Outbound mail is not configured for production. Signup, invitations, and password reset check delivery first and fail with **503** before creating a company, account, verification token, invitation, or reset token. Automated tests read tokens from the in-process `EmailSender` outbox, or from a file named by `TEST_EMAIL_OUTBOX`, only when `NODE_ENV` is exactly `test` and the database name is exactly `operations_hub_test`. There is no HTTP token endpoint. When `NODE_ENV` is exactly `development` and the database name is exactly `operations_hub`, the API logs the verification, invitation, or reset link so a local founder can open it. No other environment logs it or writes a token file.

## Unresolved

- **Email delivery.** No SMTP provider, API key, or production mailbox is chosen. Until one is, production signup, invitations, and password reset fail closed and create no records. Do not put mailbox credentials in source, seed data, or `.env.example`. This is not production onboarding.
- **Invitation expiry** as a product rule, including whether a Super Admin can resend or cancel. Seven days and no resend are only the assumption above.
- **Multiple-company membership.** This slice forbids it. Whether one person may belong to several companies later is undecided.
- **Duplicate company names.** This slice allows them. Whether names must be unique is undecided.
- Signup and invitation-acceptance throttling.
- Deployment hosting remains unresolved in `docs/product-spec.md`. Approval, handler self-claim, department editing on Departments, account Settings, and password reset are implemented. Reset-link rules are in ADR-004.

## Still rejected

- Public employee signup.
- A “working alone or in a team” question.
- A company Super Admin reading or changing another company’s accounts, departments, requests, history, sessions, or intake department list.
- Using the first-Super-Admin command as onboarding. The command exits without inserting a row.

## Verification on 24 September 2026

`20260924150000_add_company_boundary` was applied with `prisma migrate deploy` to `operations_hub` and `operations_hub_test`. Neither database was reset. `.env` was not modified.

| Command | Result |
| --- | --- |
| `npm test` | 11 suites, 72 tests, all passed |
| `npm run eval:ai` | 8 evals, all passed. `MockAiProvider` only |
| `npm run build` | Nest build passed |
| `cd frontend; npm run build` | `tsc` and Vite build passed |
| `npm run test:e2e` | 7 Playwright tests passed (2 login, 1 company signup, 3 intake, 1 request flow) |

A later pass the same day closed production mail delivery and removed `GET /auth/test/outbox`. `npx jest src/auth/company.spec.ts --testTimeout=60000` passed 1 suite and 9 tests. `npx jest src/auth/auth.spec.ts --testTimeout=60000` passed 1 suite and 17 tests. `npm run build` passed. `cd frontend; npm run build` passed. `npx playwright test e2e/company-signup.spec.ts` passed. Neither database was reset. `.env` was not modified.

A later pass the same day added the company Super Admin workspace (dashboard counts, employee list, departments). `npm test` passed 12 suites and 83 tests. `npm run build` passed. `cd frontend; npm run build` passed. `npm run test:e2e` passed 10 Playwright tests, including Super Admin navigation and the employee list. Neither database was reset. `.env` was not modified.

A later pass the same day added Super Admin viewing without ownership: Super Admin cannot become current owner, including through temporary assignment, and the Requests page has no assign or work-status actions. `npm test` passed 12 suites and 84 tests. `npm run build` passed. `cd frontend; npm run build` passed. `npm run test:e2e` passed 11 Playwright tests. Neither database was reset. `.env` was not modified. `npm run eval:ai` was not re-run; intake code did not change.

A later pass on 25 September 2026 limited Super Admin request oversight: list columns only, own-submission detail/history, **403** for unrelated same-company ids. `npm test` passed 13 suites and 89 tests. `npm run build` passed. `cd frontend; npm run build` passed. `npm run test:e2e` passed 12 Playwright tests. Neither database was reset. `.env` was not modified. `npm run eval:ai` was not re-run; intake code did not change.
