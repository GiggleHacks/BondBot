-- Sole statement so CREATE INDEX CONCURRENTLY runs outside an implicit transaction.
-- A member's recent runs are read by user and creation time without a status to narrow by.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "runs_userId_createdAt_idx" ON "runs"("userId", "createdAt");
