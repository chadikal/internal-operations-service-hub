-- CreateEnum
CREATE TYPE "ApprovalPolicy" AS ENUM ('NONE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN');

-- CreateTable
CREATE TABLE "RequestType" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approvalPolicy" "ApprovalPolicy" NOT NULL,

    CONSTRAINT "RequestType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Request" ADD COLUMN "requestTypeId" INTEGER;
ALTER TABLE "Request" ADD COLUMN "capturedApprovalPolicy" "ApprovalPolicy";

-- CreateIndex
CREATE INDEX "RequestType_companyId_idx" ON "RequestType"("companyId");

-- CreateIndex
CREATE INDEX "RequestType_departmentId_idx" ON "RequestType"("departmentId");

-- AddForeignKey
ALTER TABLE "RequestType" ADD CONSTRAINT "RequestType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestType" ADD CONSTRAINT "RequestType_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
