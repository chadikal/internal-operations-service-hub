# Week 5 — Production readiness and operations

Week 5 is about shipping, operating, diagnosing, recovering, and owning the production system. It does not add product features.

The Internal Operations Service Hub is the company-internal app for submitting and tracking help requests. Product behavior stays as described in the README and in `docs/product-spec.md`. This note is the operations record.

## Production architecture

```text
Browser
  → React/Vite frontend
    → NestJS API
      → PostgreSQL (Neon)
```

External services:

| Service | Role |
| --- | --- |
| Render | Hosts the frontend static site and the backend web service |
| Neon | PostgreSQL |
| Resend | Transactional email |
| Requesty | AI intake |

## Production deployment

### Frontend

The production frontend is a Render static site:

- Public site: `https://internalopshub.xyz`
- SPA rewrite: `/*` → `/index.html`

The UI calls the API with `VITE_API_URL`. When that variable is unset, the client uses `http://localhost:3000` (`frontend/src/api.ts`). This repository does not record the production value of `VITE_API_URL`.

### Backend

The API is a Render web service. Nest listens on Render’s `PORT` and binds to `0.0.0.0` (`src/main.ts`). If `PORT` is missing, the process falls back to `3000`. Production startup does not require `PORT`.

The repository root is the service root. `prisma` and the Nest CLI are devDependencies, so a production `npm ci` omits them unless the install includes devDependencies. The build command that matches this repository is:

```text
npm ci --include=dev && npx prisma generate && npm run build
```

The start command is `npm run start:prod`, which runs `node dist/main.js`. The build does not run `prisma migrate deploy`, `prisma migrate dev`, `prisma db push`, `prisma migrate reset`, or `prisma db seed`.

`api.internalopshub.xyz` is not configured in this repository, so this document does not treat it as a live API hostname. The split hosts used for the session cookie are the Render service URLs below. `https://internalopshub.xyz` is the name already used in this note for the public site. It is not set in application source, and this pass did not open it.

| Role | URL |
| --- | --- |
| Frontend | `https://internal-operations-service-hub-1-zpro.onrender.com` |
| API | `https://internal-operations-service-hub-g0ac.onrender.com` |

### Database

Production PostgreSQL is Neon.

- Prisma Client uses `DATABASE_URL`. In production that value is the Neon pooled connection string.
- Prisma Migrate uses `DIRECT_URL` (`directUrl` in `prisma/schema.prisma`). That value is the Neon direct connection string.
- Apply versioned migrations with `npx prisma migrate deploy`.
- Do not reset the production database, and do not run the seed as part of deployment. `npm run prisma:seed` is a local development command. Nest does not seed on start.

## Production configuration

Set these names in the Render backend environment. Do not commit values. Placeholders belong only in `.env.example`.

| Name | Production rule |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Required. Pooled Postgres URL. The value is never printed in startup errors. |
| `JWT_SECRET` | Required. At least 32 characters. |
| `AUTH_ORIGINS` | Required. Comma-separated `http` or `https` origins. No paths and no `*`. |
| `RESEND_API_KEY` | Required together with `EMAIL_FROM`. |
| `EMAIL_FROM` | Required together with `RESEND_API_KEY`. Must be a usable from address. |
| `AI_PROVIDER` | Must be `requesty`. |
| `REQUESTY_API_KEY` | Required when the provider is Requesty. |
| `REQUESTY_MODEL` | Required when the provider is Requesty. The safe example value is `mistral/leanstral-1-5`. |
| `TRUST_PROXY` | Must be exactly `true` so Express trusts Render’s proxy and uses `X-Forwarded-For` only in that case. |

`PORT` is not required. Render supplies it.

`DIRECT_URL` is not checked by production startup validation. It is required when someone runs `npx prisma migrate deploy` against production. `prisma/schema.prisma` still names it with `env("DIRECT_URL")`. This pass did not re-test whether a missing `DIRECT_URL` stops Prisma Client from connecting.

When `NODE_ENV` is exactly `production`, `assertRuntimeConfig` runs before Nest accepts traffic. Invalid or missing critical configuration exits the process. The error names the variable, for example `Invalid production configuration: JWT_SECRET is required`. It does not print secrets, database URLs, or `process.env`. `development`, `test`, and an unset `NODE_ENV` skip those production checks. Jest and Playwright keep using `operations_hub_test` and do not need Resend or Requesty credentials.

## Session cookie

The browser stores an `HttpOnly` cookie named `hub_session`. `Path=/`. There is no `Domain` attribute, so the cookie stays host-only on the API. Login and logout use the same `SameSite` and `Secure` attributes.

| Environment | Cookie |
| --- | --- |
| Not production, including local development | `SameSite=Lax`, `Secure` omitted |
| `NODE_ENV=production` | `SameSite=None; Secure` |

The frontend calls the API with `credentials: 'include'` (`frontend/src/api.ts`). The frontend and API are different hosts, so a production `SameSite=Lax` cookie is not sent on those cross-site requests. `SameSite=None; Secure` is what lets the session travel from the frontend origin to the API origin. CSRF checks, Origin checks, the `AUTH_ORIGINS` allowlist, session expiry, and revocation are unchanged. `AUTH_ORIGINS` must include the frontend origin or login is rejected before a cookie is set.

## Health model

All three routes are public.

| Method | Path | Meaning |
| --- | --- | --- |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Database readiness |
| GET | `/health` | Same response as `/health/live` |

`GET /health/live` returns HTTP 200 and `{ "status": "ok" }`. It does not query PostgreSQL, Resend, or Requesty. A process that is up but cannot reach the database still passes liveness.

`GET /health/ready` runs `SELECT 1` through Prisma. HTTP 200 is `{ "status": "ready" }`. Failure is HTTP 503 and `{ "status": "not_ready" }`. The response does not include Prisma errors or connection details. The server log line is `Database readiness check failed`, plus the request id when one exists.

Render’s platform health check should use `/health/live`. `/health/ready` answers a different question: whether this process can use PostgreSQL. A brief database blip would fail readiness and can cause the platform to replace a process that is otherwise up. Liveness stays a process check. Use `/health/ready` when an operator wants to know that the database dependency is accepting a read.

## Operational logging

Every HTTP response sets `X-Request-Id`. If the incoming `X-Request-Id` is 1–128 characters from `A–Z`, `a–z`, `0–9`, `.`, `_`, `:`, and `-`, that value is kept. Any other value is replaced with a UUID. The id is held for the request only. It is not written to PostgreSQL. CORS allows and exposes the header.

A failed HTTP request logs one line with:

- method
- path, with the query string removed
- status code
- request id
- exception category, and a short code when there is one

A fixed, known-safe client message may be included. Messages that embed user-supplied text are not logged. That includes request-type names, a raw department-template id, and validation errors (those are logged as `code=validation` only). Unhandled errors log the error name and a short code such as `ECONNREFUSED`, not the exception text. Clients still receive the existing HTTP body. They do not receive stack traces, Prisma errors, Resend errors, or Requesty payloads.

Dependency logs:

- PostgreSQL readiness: `Database readiness check failed`, with the request id.
- Resend: `Resend email send failed`, with purpose, `provider=resend`, request id, and a redacted provider code/message. API keys and `verify`, `invite`, and `reset` token query values are redacted.
- Requesty: the existing attempt, model name, elapsed time, and HTTP status (or `httpStatus=none` when there is no status), with the request id added on the intake failure line. The provider retries HTTP 429 and 503, up to three attempts. The API key is redacted if it appears in an upstream detail. The client still gets the fixed intake error.

Startup logs one line: `Application started`, `NODE_ENV` (`development`, `test`, `production`, `unset`, or `invalid`), the listen port, and whether trust proxy is enabled. It does not print configuration values.

The API does not log:

- `DATABASE_URL` or `DIRECT_URL`
- `JWT_SECRET`
- API keys
- authorization headers
- passwords
- email addresses, where the message is not a fixed sentence that merely says “email”
- verification, reset, or invitation tokens
- request bodies
- AI prompt text or employee intake text
- raw unknown exception text
- `process.env`

On the local development database `operations_hub`, with `NODE_ENV=development` and Resend unset, the API still prints the verification, invitation, or reset link in the API terminal. That path is not used when Resend is configured, and it is not used for tests or for any other database.

## Email production behavior

Resend sends three transactional messages:

- workspace email verification
- password reset
- staff invitation

Production startup requires both `RESEND_API_KEY` and `EMAIL_FROM`. The API sends through Resend only when both are set, `NODE_ENV` is not `test`, and the database is not `operations_hub_test`. A provider failure returns HTTP 503 with `Email could not be sent. Try again later.` The client does not receive the Resend error or the API key.

Automated tests delete `RESEND_API_KEY` and use the in-process outbox, or the file named by `TEST_EMAIL_OUTBOX`, only when `NODE_ENV` is `test` and the database name is `operations_hub_test`. Tests do not call Resend.

Local development on `operations_hub` can keep the terminal outbox when either Resend variable is blank.

This repository does not record a confirmed Resend sending domain. `https://internalopshub.xyz` is the frontend site. It is not, by itself, proof of the `EMAIL_FROM` domain. The example file uses a non-production placeholder and must not be copied into Render as a real sender.

## AI production behavior

Production sets `AI_PROVIDER=requesty`. The model name in `.env.example`, and the code default when the variable is unset outside production, is `mistral/leanstral-1-5`. Production startup requires `REQUESTY_MODEL` to be set explicitly. The key stays on the NestJS server. The browser only calls `POST /ai/intake`.

Intake is advisory. It may suggest troubleshooting and a draft. It does not create a request, choose approval policy, or bypass authorization. The API loads department and request-type ids from PostgreSQL and rejects model output that does not match the intake schema. Identity, authorization, and request rules stay in the backend.

A provider or network failure becomes HTTP 503 and `The intake assistant is unavailable. Try again later.` Invalid model output becomes HTTP 502 and `The intake assistant returned an invalid result.` Neither response includes the Requesty body or the API key. Safe retry and status details stay in the server log, as described above.

## Controlled failure and recovery

This is the Week 5 exercise. It is recorded from that exercise, not from a log file stored in the repository. No timestamps or upstream provider bodies are included, because those artifacts are not in the repo.

### Known good

The backend was deployed. `GET /health/live` returned 200. `GET /health/ready` returned 200. AI intake succeeded.

### Failure

`REQUESTY_MODEL` was temporarily set to a model name that does not exist. The Requesty API key was not changed. Database configuration was not changed.

### Detect

The process stayed live. Database readiness stayed healthy. AI intake failed. The client showed the existing sanitized “intake assistant is unavailable” behavior. Render logs showed a Requesty failure tied to the model configuration and did not include credentials.

### Diagnose

The NestJS process was healthy. PostgreSQL was healthy. The failure was limited to Requesty model configuration.

### Recover

The previous `REQUESTY_MODEL` was restored and the service was redeployed.

### Verify

Health endpoints were healthy again, and AI intake worked again.

```text
Known good → Failure → Detect → Diagnose → Recover → Verify
```

### Evidence

Screenshot files are not in this repository. Attach them beside this note when they are captured:

- successful health check
- AI intake working before the failure
- AI failure in the UI
- sanitized Render log
- successful AI result after recovery

## Test and release evidence

Release-candidate verification on 29 September 2026. These commands were run locally against `operations_hub_test`, not Neon, and were not live production checks.

| Check | Result |
| --- | --- |
| `npx jest --runInBand` | 30 suites passed, 208 tests passed, 0 failed |
| `npx playwright test` | 26 passed, 0 failed |
| `npx prisma validate` | Schema valid |
| `npm run build` | Succeeded |

One Playwright test, “request tables keep readable columns and separate approval from work status” in `e2e/super-admin-requests.spec.ts`, failed because the approval detail overlay stays open after Approve and then covers the next table click. The test was updated to close that overlay before using the table again. The assertions were not removed. Frontend product behavior was not changed. The full Playwright run after that test edit passed all 26 tests.

## Migration safety

Migrations are versioned SQL files under `prisma/migrations`. Production applies them with:

```powershell
npx prisma migrate deploy
```

Run that with production `DATABASE_URL` (pooled) and `DIRECT_URL` (direct). Do not use `prisma migrate reset` on production. Do not use `prisma db push` as the production migration path. There is no production seed step.

`20260929133000_remove_empty_development_company` deletes a company named `Development` with status `ACTIVE` only when that company still has no departments, request types, employees, requests, history, approval decisions, sessions, verifications, invitations, or password resets. A Development company that already owns data is left in place. Migration history was not rewritten. Older migration directories were not edited to remove that company.

## Graceful shutdown

`src/main.ts` calls `app.enableShutdownHooks()`. On a platform shutdown signal, Nest runs module destroy hooks, including `PrismaService.$disconnect()`. That gives an in-flight Render restart or redeploy a chance to close the database client cleanly. It does not guarantee that every in-flight HTTP request finishes, and it does not add a custom drain timeout beyond what Nest already does.

## Known limitations

- Staff invitations prepared during workspace onboarding are stored in `sessionStorage` under `hub-pending-invites` until the founder verifies and logs in (`frontend/src/pending-invites.ts`). They are not durable server state at that step.
- This repository does not record the Render instance size. If a service is on Render’s free tier, the platform can cold-start it after idle time.
- Settings in the running UI is Profile, Security, and Company or My Department. A notification center and notification preferences are not implemented.
- `/health/ready` checks PostgreSQL only. It does not call Resend or Requesty.
- There is no external APM or log platform in the application. Operators use Render logs and the health routes.
- Production depends on Render, Neon, Resend, and Requesty being available. The app does not replace those services.

## Release checklist

Checked items are the local verification above. Production sign-off items stay open until an operator records them. Do not treat an empty box as done.

- [ ] Production migrations applied with `npx prisma migrate deploy` (no reset, no seed)
- [ ] Production environment accepted by startup validation (`NODE_ENV=production` and the variables in this note)
- [x] Backend build passed (`npm run build`, 29 September 2026)
- [x] Backend tests passed (30 suites, 208 tests, 0 failed)
- [x] Playwright passed (26 passed, 0 failed)
- [ ] `GET /health/live` healthy on the deployed API
- [ ] `GET /health/ready` healthy on the deployed API
- [ ] Login and session smoke test on production (production cookie is `SameSite=None; Secure`, host-only on the API)
- [ ] Critical request workflow smoke test on production
- [ ] Resend verification, reset, or invitation smoke test on production
- [ ] Requesty AI intake smoke test on production
- [ ] Controlled failure and recovery completed, with the evidence list above attached
- [ ] Production frontend URL `https://internalopshub.xyz` verified for this release
- [ ] Git SHA recorded
- [ ] Deployed SHA matches the intended release
