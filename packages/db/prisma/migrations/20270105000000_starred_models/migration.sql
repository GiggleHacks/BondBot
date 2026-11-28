-- Additive: the previous release never reads this table.
CREATE TABLE "starred_models" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "starred_models_pkey" PRIMARY KEY ("userId", "provider", "modelId")
);

ALTER TABLE "starred_models" ADD CONSTRAINT "starred_models_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "starred_models" ENABLE ROW LEVEL SECURITY;
CREATE POLICY starred_models_tenant ON "starred_models"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY starred_models_system ON "starred_models" USING ((SELECT app_rls_bypass()));
