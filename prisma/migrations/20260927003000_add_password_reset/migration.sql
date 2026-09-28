CREATE TABLE "PasswordReset" (
    "tokenHash" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX "PasswordReset_companyId_idx" ON "PasswordReset"("companyId");
CREATE INDEX "PasswordReset_accountId_idx" ON "PasswordReset"("accountId");

ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
