# Week 4 Production AI — Request Intake

Advisory request intake for the Internal Operations Service Hub. The model may suggest troubleshooting and a draft. It cannot create or mutate a request.

## Capability

An employee describes what they need in free text. One backend call analyzes that text with bounded product context (canonical departments) and returns a structured result.

The AI distinguishes two situations:

- **problem** — something is broken or not working. The UI shows up to 3 safe troubleshooting steps, then asks if the problem was solved. If it was, the flow ends with no request. If not, the employee is asked whether to prepare a request.
- **need** — a straightforward request (laptop, HR certificate). Troubleshooting is not offered. The employee is asked whether to prepare a request.

A draft is shown only after the employee chooses to prepare one. They review and edit department, title, and description, then click **Create Request**. Only existing `POST /requests` creates the row. Status starts `SUBMITTED` with no owner, as in Week 3.

## Advisory boundary

- `POST /ai/intake` is read-only with respect to request state. It may read departments and verify the actor. It does not insert or update `Request` or `RequestStatusHistory`.
- `AiService` does not call `RequestsService`.
- The provider cannot emit status, owner, history, or approval fields. Extra keys are invalid output.
- The UI never auto-submits after Analyze.
- Ending the flow as solved or declined creates nothing.

## Structured result

```ts
{
  situation: 'problem' | 'need',
  troubleshootingSteps: string[],      // 0–3; forced empty when situation is need
  missingInformation: string[],
  draft: {
    departmentId: number | null,       // must exist in Department, else null
    summary: string | null,            // suggested title
    description: string | null
  } | null
}
```

`title` and `description` on `Request` are ordinary optional product fields. Manual create and intake drafts both use them. Clients that still send only `{ submittedBy, departmentId }` remain valid; omitted text is stored as `null`.

## Trusted context

The backend loads `{ id, name }` for departments from PostgreSQL (the same source as `GET /departments`) and tells the provider it may only use those IDs. Seeded departments are IT, HR, and Finance. A mention of Legal cannot invent a department.

Runtime uses Requesty (`RequestyAiProvider`) when `AI_PROVIDER=requesty`. Requesty is an OpenAI-compatible gateway; `REQUESTY_MODEL` selects the model. Gemini was used during early development and was replaced because Requesty's free development limits were a better fit for this project.

Automated tests and evals always use `MockAiProvider` and never call Requesty, the network, or a live model.

Requesty is asked for structured JSON matching the intake schema (`response_format.type = json_schema` plus the schema). `AiService` still runs `validateIntakeResult` on that JSON before returning it to the UI. The Requesty API key stays on the NestJS server; the frontend only calls `POST /ai/intake`.

### Runtime configuration

Copy these from `.env.example` into `.env`. Do not commit a real key.

```env
AI_PROVIDER=requesty
REQUESTY_API_KEY=
REQUESTY_MODEL=nemotron-3.5-lightning-30b-a3b
```

Jest, `npm run eval:ai`, and Playwright force `AI_PROVIDER=mock` even if `.env` says `requesty`.

## API

Request and intake routes require `X-Actor-Id`. Any seeded employee may use intake, including John (`canHandle=false`).

### `POST /ai/intake`

```http
X-Actor-Id: 2
{ "text": "I need a laptop." }
```

**502** invalid provider JSON. **503** provider failure, including Requesty HTTP/network errors and a missing `REQUESTY_API_KEY`.

None of those statuses write a request.

### `POST /requests`

Unchanged lifecycle. Optional body fields:

```json
{ "submittedBy": 2, "departmentId": 1, "title": "Laptop request", "description": "I need a laptop." }
```

## Frontend flow

The Week 3 Create Request card remains. Intake is a separate card on the same view.

1. Employee enters free text and clicks Analyze (one provider call).
2. Problem with steps → show steps → “Did this solve the problem?”
3. Solved → stop. Unresolved → “Prepare a request?”
4. Need → skip steps → “Prepare a request?”
5. After yes, show an editable draft (department, title, description).
6. Create Request calls the existing create API.

## Tests and evals

Deterministic HTTP tests in `src/ai/ai.http.spec.ts` prove:

- successful intake writes no request/history
- invalid provider output → 502, no write
- provider failure → 503, no write
- missing, non-integer, and unknown `X-Actor-Id` → 400

`src/ai/intake.schema.spec.ts` covers department sanitization, max 3 steps, and rejection of extra fields such as `status`.

Eval command (8 cases, same test database rules as `npm test`):

```powershell
npm run eval:ai
```

| # | Case | Input / fixture | Expected |
| --- | --- | --- | --- |
| 1 | Clear problem | My laptop won't connect to Wi-Fi. | `problem`, 3 steps, IT draft, no DB write |
| 2 | Clear need | I need a laptop. | `need`, no steps, IT draft |
| 3 | Clear need + department | I need an employment certificate from HR. | `need`, no steps, HR draft |
| 4 | Thin | I need help. | missing information, `draft` null |
| 5 | Ambiguous | My computer is broken and I also need a certificate. | missing information, no department |
| 6 | Trusted context | Please send this to Legal. | does not invent Legal, `draft` null |
| 7 | Invalid output | provider returns `status: COMPLETED` and `departmentId: 999` | 502, no write, 999 not trusted |
| 8 | Provider failure | provider throws | 503, no write |

Week 3 suites remain in `npm test`. Optional title/description persistence is covered in `requests.persistence.spec.ts`.

## Evidence commands

```powershell
npm run test:db:setup
npm test
npm run eval:ai
```

Browser e2e is unchanged: `npm run test:e2e` still walks John creating an IT request and Chadi starting it. It does not use intake.

## Out of scope

Chat, policy Q&A, a second AI call, automatic submit, owner assignment, and approvals.
