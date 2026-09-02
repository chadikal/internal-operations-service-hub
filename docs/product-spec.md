# Internal Operations Service Hub

A company-internal system for requesting and tracking help from departments such as IT, HR, and Finance.

## Problem / Context

Employees request help from departments such as IT, HR, and Finance through messy channels.

This leads to forgotten requests, requests being sent to the wrong person, and unclear ownership, status, and approval.

## Known Facts

- Employees currently ask for help through messy channels.
- Requests get forgotten.
- Requests get sent to the wrong person.
- Request ownership, status, and approval are unclear.
- The company wants one system to submit, handle, and follow requests.

## Actors / Stakeholders

### Actors

- Employees
- HR staff
- IT staff
- Finance staff

### Stakeholders

- Employees
- HR department
- IT department
- Finance department

## Functional Requirements

- Employees can submit help requests to the appropriate department.
- Department staff can view requests submitted to their department.
- Department staff can update the status of requests they handle.
- Employees can view their submitted requests and their current status.
- The system should show who is responsible for handling a request.
- The system should support an approval process for requests that require approval.

## Non-Functional Requirements

- Pages should load within a reasonable amount of time.
- Request status changes should become visible to employees without unnecessary delay.
- The system should prevent unauthorized access to requests and their information.
- The system should be available when employees and department staff need to submit, handle, or follow requests.

## Assumptions / Constraints / Unknowns

### Assumptions

- We assume department staff are responsible for updating request statuses.

### Constraints

- No constraints have been explicitly provided.

### Unknowns

- How will employees and department staff authenticate?
- What information is required when submitting a request?
- What response/loading time is considered acceptable?
- How quickly must status changes become visible?
- Who is authorized to view each type of request?
- Are some requests confidential, especially HR or Finance requests?
- Are there specific availability requirements?
- Who can approve requests?
- Which requests require approval?
- What are the possible approval outcomes?
- How is request ownership assigned?
- What request statuses should exist?
- Which departments should the system support?

## Non-Goals

- The system will not perform or resolve the actual work requested from departments. It will only support submitting, handling, and following those requests.

## Acceptance Criteria

### Positive Cases

- When an employee submits a request with the required information to an appropriate department, the request is successfully created.
- When a request is submitted to a department, authorized department staff can view it.
- When authorized department staff update a request's status, the new status is successfully saved.
- When a request's status is updated, the employee can view its updated status.
- An employee can view their submitted requests.
- When a request has an assigned owner, the responsible owner is visible to the employee.
- When a request requires approval, the system supports the defined approval process.

### Negative / Failure Cases

- When an unauthorized user attempts to access request information they are not permitted to view, access is denied.
- When required request information is missing, the request is not successfully submitted.
- A failed status update must not be presented to the employee as a successful status change.
