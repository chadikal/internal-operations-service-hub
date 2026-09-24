# ADR-003: Company signup and company-scoped access

Status: **implemented** on `feature/full-product-foundation`. This decision replaces the first-Super-Admin command as the normal onboarding path. It does not rewrite ADR-002 or the weekly notes. Claiming, approvals, admin screens, password reset, and deployment hosting stay open in `docs/product-spec.md`.

## Decision

A founder creates one company workspace with a company name, their name, their email, and a password. The workspace and that first Super Admin account stay inactive until the founder verifies the email. After verification, the Super Admin can add departments in that company and invite staff. Invitees set their own passwords. There is no public employee signup and no question about working alone or in a team.

Super Admin authority is limited to that company. Accounts, departments, requests, sessions, status history, invitations, and email verifications carry a company boundary. Backend queries and authorization include that boundary on request, history, lookup, and AI intake routes. A caller in company A cannot read or change company B’s data by sending B’s ids.

This slice does not turn a company Super Admin into a viewer of every request in the company. The temporary rule remains: view a request in your own company when you submitted it or `canHandle` is true. The planned “Super Admin sees every request” rule, once built, applies only inside that company. It is not implemented here, and it is not global.

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
- The founder’s `departmentId` is null. Staff invitations require a department in that company, so the Super Admin can `POST /departments` before inviting. That endpoint is not a department-admin screen.
- Verification and acceptance do not sign the person in.
- An invitation reserves the email by creating an inactive account with no password hash. Acceptance sets the hash and `active=true`.
- A Super Admin may invite Employee, Department Admin, or Super Admin. The new Super Admin is scoped to the same company and does not gain access to other companies.
- Cross-company request and history ids use the same **404** as a missing id. Cross-company employee and department ids use the same **400** as an unknown id. The response does not include the other company’s data.
- Links use the first `AUTH_ORIGINS` entry, or `http://localhost:5173` when that list is empty.
- Outbound mail is not configured for production. Signup and invitations check delivery first and fail with **503** before creating a company, account, verification token, or invitation. Automated tests read tokens from the in-process `EmailSender` outbox, or from a file named by `TEST_EMAIL_OUTBOX`, only when `NODE_ENV` is exactly `test` and the database name is exactly `operations_hub_test`. There is no HTTP token endpoint. When `NODE_ENV` is exactly `development` and the database name is exactly `operations_hub`, the API logs the link so a local founder can open it. No other environment logs it or writes a token file.

## Unresolved

- **Email delivery.** No SMTP provider, API key, or production mailbox is chosen. Until one is, production signup and invitations fail closed and create no records. Do not put mailbox credentials in source, seed data, or `.env.example`. This is not production onboarding.
- **Invitation expiry** as a product rule, including whether a Super Admin can resend or cancel. Seven days and no resend are only the assumption above.
- **Multiple-company membership.** This slice forbids it. Whether one person may belong to several companies later is undecided.
- **Duplicate company names.** This slice allows them. Whether names must be unique is undecided.
- Signup and invitation-acceptance throttling.
- Password reset, deployment hosting, claiming, approvals, and the other open items in `docs/product-spec.md`.

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
