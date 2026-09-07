# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized department staff can view and handle requests sent to their department.

## Current Stage

This repository contains the product requirements, initial system design, and a bounded Week 2 NestJS backend slice for Service Request status transitions.

This is not the full application. There is no frontend, no real database, and no authentication system. Data is stored in memory and is lost when the process stops.

## Install

Requires Node.js 18 or later.

```powershell
npm install
```

## Start the API

```powershell
npm start
```

The API listens on `http://localhost:3000`.

Restart the process before a clean verification run. In-memory IDs start at 1 after each restart.

## Week 2 Lifecycle Assumptions

Week 1 did not define exact request statuses or allowed transitions.

For this bounded Week 2 implementation, the following assumptions are used:

- Requests start as `SUBMITTED`.
- The implemented lifecycle is `SUBMITTED -> IN_PROGRESS -> COMPLETED`.
- `COMPLETED` is terminal for this slice.
- A current owner must exist before a status transition can occur.
- These assumptions apply only to the Week 2 slice and do not define the complete product lifecycle.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/requests` | Create a request. Always starts as `SUBMITTED`. Body: `{ "submittedBy": 1, "departmentId": 2 }` |
| GET | `/requests/:id` | Inspect the current request |
| PATCH | `/requests/:id/owner` | Assign `currentOwnerId`. Body: `{ "currentOwnerId": 7 }` |
| PATCH | `/requests/:id/transition` | Attempt a lifecycle transition. Body: `{ "to": "IN_PROGRESS", "changedBy": 7 }` |
| GET | `/requests/:id/history` | Inspect successful status history |

Allowed transitions for this Week 2 slice: `SUBMITTED -> IN_PROGRESS -> COMPLETED`.

The client cannot choose the initial status. Status changes can only occur through the transition endpoint, and the service enforces the allowed lifecycle transitions.

`changedBy` represents the employee performing the update for this bounded implementation. It is **not** authentication. The service checks `changedBy === currentOwnerId` to enforce the Week 1 rule that the current owner updates the Request status.

## Reproduce the proof cases

Run these PowerShell commands while the API is running. They capture request IDs so they stay valid after a restart.

```powershell
$base = "http://localhost:3000"

function Invoke-Api {
  param([string]$Method, [string]$Url, $Body)
  $params = @{ Method = $Method; Uri = $Url; ContentType = "application/json" }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  try {
    $resp = Invoke-WebRequest @params -UseBasicParsing
    [pscustomobject]@{ StatusCode = [int]$resp.StatusCode; Body = ($resp.Content | ConvertFrom-Json) }
  } catch {
    $status = 0
    $parsed = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($_.ErrorDetails.Message) {
      try { $parsed = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $parsed = $_.ErrorDetails.Message }
    } else { $parsed = $_.Exception.Message }
    [pscustomobject]@{ StatusCode = $status; Body = $parsed }
  }
}
```

### VALID CASE 1 — SUBMITTED to IN_PROGRESS

```powershell
$create1 = Invoke-Api POST "$base/requests" @{ submittedBy = 1; departmentId = 2 }
$id1 = $create1.Body.id
Invoke-Api PATCH "$base/requests/$id1/owner" @{ currentOwnerId = 7 }
Invoke-Api PATCH "$base/requests/$id1/transition" @{ to = "IN_PROGRESS"; changedBy = 7 }
Invoke-Api GET "$base/requests/$id1"
Invoke-Api GET "$base/requests/$id1/history"
```

Expected: create `201` with `status = SUBMITTED` and `currentOwnerId = null`; owner assign `200`; transition `200` with `status = IN_PROGRESS`; history has one record `SUBMITTED -> IN_PROGRESS`, `changedBy = 7`.

Actual (this run): matched. Request `1` became `IN_PROGRESS`. History: one record, `previousStatus = SUBMITTED`, `newStatus = IN_PROGRESS`, `changedBy = 7`.

### VALID CASE 2 — IN_PROGRESS to COMPLETED

```powershell
Invoke-Api PATCH "$base/requests/$id1/transition" @{ to = "COMPLETED"; changedBy = 7 }
Invoke-Api GET "$base/requests/$id1"
Invoke-Api GET "$base/requests/$id1/history"
```

Expected: `200`; `status = COMPLETED`; second history record `IN_PROGRESS -> COMPLETED`, `changedBy = 7`.

Actual (this run): matched. Request `1` became `COMPLETED`. History had two records.

### INVALID CASE 1 — SUBMITTED to COMPLETED

```powershell
$create2 = Invoke-Api POST "$base/requests" @{ submittedBy = 1; departmentId = 2 }
$id2 = $create2.Body.id
Invoke-Api PATCH "$base/requests/$id2/owner" @{ currentOwnerId = 7 }
Invoke-Api PATCH "$base/requests/$id2/transition" @{ to = "COMPLETED"; changedBy = 7 }
Invoke-Api GET "$base/requests/$id2"
Invoke-Api GET "$base/requests/$id2/history"
```

Expected: `409`; status remains `SUBMITTED`; history stays empty.

Actual (this run): matched. HTTP `409` `"Transition from SUBMITTED to COMPLETED is not allowed"`. Request `2` stayed `SUBMITTED`. History `[]`.

### INVALID CASE 2 — COMPLETED to IN_PROGRESS

```powershell
Invoke-Api PATCH "$base/requests/$id1/transition" @{ to = "IN_PROGRESS"; changedBy = 7 }
Invoke-Api GET "$base/requests/$id1"
Invoke-Api GET "$base/requests/$id1/history"
```

Expected: `409`; status remains `COMPLETED`; history still has only the two successful records.

Actual (this run): matched. HTTP `409` `"Transition from COMPLETED to IN_PROGRESS is not allowed"`. Request `1` stayed `COMPLETED`. History unchanged (2 records).

### WEEK 1 OWNER RULE — changedBy is not the current owner

```powershell
$create3 = Invoke-Api POST "$base/requests" @{ submittedBy = 1; departmentId = 2 }
$id3 = $create3.Body.id
Invoke-Api PATCH "$base/requests/$id3/owner" @{ currentOwnerId = 7 }
Invoke-Api PATCH "$base/requests/$id3/transition" @{ to = "IN_PROGRESS"; changedBy = 12 }
Invoke-Api GET "$base/requests/$id3"
Invoke-Api GET "$base/requests/$id3/history"
```

Expected: `409`; status remains `SUBMITTED`; no history record.

Actual (this run): matched. HTTP `409` `"Only the current owner can update the request status"`. Request `3` stayed `SUBMITTED` with `currentOwnerId = 7`. History `[]`.

### NO OWNER CASE — transition with currentOwnerId null

```powershell
$create4 = Invoke-Api POST "$base/requests" @{ submittedBy = 1; departmentId = 2 }
$id4 = $create4.Body.id
Invoke-Api PATCH "$base/requests/$id4/transition" @{ to = "IN_PROGRESS"; changedBy = 7 }
Invoke-Api GET "$base/requests/$id4"
Invoke-Api GET "$base/requests/$id4/history"
```

Expected: `409`; status remains `SUBMITTED`; no history record.

Actual (this run): matched. HTTP `409` `"A current owner must be assigned before a status transition"`. Request `4` stayed `SUBMITTED` with `currentOwnerId = null`. History `[]`.

## Documentation

The project documentation is located in the `docs` folder:

- `product-spec.md` describes the problem, requirements, assumptions, constraints, unknowns, and acceptance criteria.
- `architecture.md` describes the actors, responsibilities, components, system boundaries, main flow, and architectural decisions.
- `data-model.md` describes the entities, relationships, lifecycle rules, storage choice, and access patterns.
- `decisions/ADR-001.md` records the decision to use synchronous communication for request submission and explains why it was chosen.
- `week2-agentic-workflow.md` records the Week 2 UNDERSTAND / DIRECT / PROVE notes for the bounded request lifecycle slice.

## Week 1 Open Unknowns

At the full-product level, some details remain undefined, including authentication, required request fields, confidentiality rules, approval rules, ownership assignment, request statuses, and supported departments.

For the bounded Week 2 implementation only, the lifecycle states `SUBMITTED`, `IN_PROGRESS`, and `COMPLETED` are explicit implementation assumptions and do not resolve the full-product status model.
