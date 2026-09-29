-- 20260924150000_add_company_boundary inserted one ACTIVE company named Development
-- and did not assign a fixed id. Remove that bootstrap row only when it still has
-- no company-scoped data. A Development company that owns any workspace data stays,
-- as does any other company with the same name.

DELETE FROM "Company" AS company
WHERE company."name" = 'Development'
  AND company."status" = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "Department" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "RequestType" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "Employee" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "Request" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "RequestStatusHistory" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "ApprovalDecision" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "Session" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "EmailVerification" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "Invitation" AS row WHERE row."companyId" = company."id")
  AND NOT EXISTS (SELECT 1 FROM "PasswordReset" AS row WHERE row."companyId" = company."id");
