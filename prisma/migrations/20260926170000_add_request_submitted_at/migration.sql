-- Existing rows have no separate submit timestamp. statusUpdatedAt is the only stored time.
ALTER TABLE "Request" ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Request" SET "submittedAt" = "statusUpdatedAt";
