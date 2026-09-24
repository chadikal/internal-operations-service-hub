-- Additive credential and session columns. Existing employee ids, requests, and history are unchanged.
-- Email and passwordHash stay null, so current rows cannot sign in until credentials are set.

CREATE TYPE "AccountRole" AS ENUM ('EMPLOYEE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN');

ALTER TABLE "Employee" ADD COLUMN "email" TEXT;
ALTER TABLE "Employee" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Employee" ADD COLUMN "role" "AccountRole" NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE "Employee" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
