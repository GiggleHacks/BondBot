-- Voice notes on their way into a chat, a personal resource (userId, spaceId). Additive.
CREATE TABLE "voice_notes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT,
    "groupId" TEXT,
    "mimeType" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "parts" INTEGER NOT NULL,
    "receivedParts" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "segmentsDone" INTEGER NOT NULL DEFAULT 0,
    "segmentsTotal" INTEGER NOT NULL DEFAULT 0,
    "segmentTexts" JSONB,
    "artifactId" TEXT,
    "transcript" TEXT,
    "error" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_notes_userId_clientId_key" ON "voice_notes"("userId", "clientId");
CREATE INDEX "voice_notes_spaceId_userId_status_idx" ON "voice_notes"("spaceId", "userId", "status");
CREATE INDEX "voice_notes_status_updatedAt_idx" ON "voice_notes"("status", "updatedAt");

-- Leaving a Space deletes the membership, and with it the member's voice notes there.
ALTER TABLE "voice_notes" ADD CONSTRAINT "voice_notes_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voice_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_notes_tenant ON "voice_notes"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '')
     AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY voice_notes_system ON "voice_notes"
  USING ((SELECT app_rls_bypass()));
