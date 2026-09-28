-- Record the time a claim succeeds. Existing owned rows stay null.
ALTER TABLE "Request" ADD COLUMN "claimedAt" TIMESTAMP(3);
