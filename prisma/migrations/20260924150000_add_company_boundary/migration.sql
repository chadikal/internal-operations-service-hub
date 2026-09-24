-- Attach every existing row to one Development company. Do not delete rows or invent passwords.

CREATE TYPE "CompanyStatus" AS ENUM ('PENDING', 'ACTIVE');

CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Company" ("name", "status", "createdAt")
VALUES ('Development', 'ACTIVE', CURRENT_TIMESTAMP);

ALTER TABLE "Department" ADD COLUMN "companyId" INTEGER;
UPDATE "Department"
SET "companyId" = (SELECT "id" FROM "Company" ORDER BY "id" ASC LIMIT 1);
ALTER TABLE "Department" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Employee" ADD COLUMN "companyId" INTEGER;
UPDATE "Employee"
SET "companyId" = (SELECT "id" FROM "Company" ORDER BY "id" ASC LIMIT 1);
ALTER TABLE "Employee" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "departmentId" DROP NOT NULL;

ALTER TABLE "Request" ADD COLUMN "companyId" INTEGER;
UPDATE "Request" AS request_row
SET "companyId" = department_row."companyId"
FROM "Department" AS department_row
WHERE request_row."departmentId" = department_row."id";
ALTER TABLE "Request" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "RequestStatusHistory" ADD COLUMN "companyId" INTEGER;
UPDATE "RequestStatusHistory" AS history_row
SET "companyId" = request_row."companyId"
FROM "Request" AS request_row
WHERE history_row."requestId" = request_row."id";
ALTER TABLE "RequestStatusHistory" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Session" ADD COLUMN "companyId" INTEGER;
UPDATE "Session" AS session_row
SET "companyId" = employee_row."companyId"
FROM "Employee" AS employee_row
WHERE session_row."accountId" = employee_row."id";
ALTER TABLE "Session" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Request" ADD CONSTRAINT "Request_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestStatusHistory" ADD CONSTRAINT "RequestStatusHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");
CREATE INDEX "Request_companyId_idx" ON "Request"("companyId");
CREATE INDEX "RequestStatusHistory_companyId_idx" ON "RequestStatusHistory"("companyId");
CREATE INDEX "Session_companyId_idx" ON "Session"("companyId");

CREATE TABLE "EmailVerification" (
    "tokenHash" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("tokenHash")
);

CREATE TABLE "Invitation" (
    "tokenHash" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "invitedById" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("tokenHash")
);

CREATE UNIQUE INDEX "Invitation_accountId_key" ON "Invitation"("accountId");
CREATE INDEX "EmailVerification_companyId_idx" ON "EmailVerification"("companyId");
CREATE INDEX "EmailVerification_accountId_idx" ON "EmailVerification"("accountId");
CREATE INDEX "Invitation_companyId_idx" ON "Invitation"("companyId");

ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
