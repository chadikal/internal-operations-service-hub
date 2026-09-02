# Internal Operations Service Hub

## Project Description

The Internal Operations Service Hub is a company-internal system for submitting and tracking help requests to departments such as IT, HR, and Finance.

The project aims to replace scattered request channels with one system where employees can submit requests and follow their status, while authorized department staff can view and handle requests sent to their department.

## Current Stage

This repository contains the product requirements and initial system design. It does not contain a complete frontend or backend implementation yet.

Because implementation has not started, there are currently no setup steps or technical prerequisites.

## Documentation

The project documentation is located in the `docs` folder:

- `product-spec.md` describes the problem, requirements, assumptions, constraints, unknowns, and acceptance criteria.
- `architecture.md` describes the actors, responsibilities, components, system boundaries, main flow, and architectural decisions.
- `data-model.md` describes the entities, relationships, lifecycle rules, storage choice, and access patterns.
- `decisions/ADR-001.md` records the decision to use synchronous communication for request submission and explains why it was chosen.

## Important Current Unknowns

Some details still require clarification before implementation, including authentication, required request fields, confidentiality rules, approval rules, ownership assignment, request statuses, and supported departments.
