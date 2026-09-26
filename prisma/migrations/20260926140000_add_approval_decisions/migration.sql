-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionOutcome" AS ENUM ('APPROVED', 'DENIED');

-- AlterTable
ALTER TABLE "Request" ADD COLUMN "approvalState" "ApprovalState";

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "requestId" INTEGER NOT NULL,
    "decision" "ApprovalDecisionOutcome" NOT NULL,
    "reason" TEXT,
    "approverId" INTEGER NOT NULL,
    "approverRole" "AccountRole" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_key" ON "ApprovalDecision"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_companyId_idx" ON "ApprovalDecision"("companyId");

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Denial stores a reason. Approval does not require one.
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_denial_reason_check" CHECK (
    "decision" <> 'DENIED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)
);
