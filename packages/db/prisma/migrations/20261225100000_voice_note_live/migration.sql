-- Voice notes transcribed while still recording keep how far the transcript reaches. Additive.
ALTER TABLE "voice_notes" ADD COLUMN "transcribedUntil" DOUBLE PRECISION NOT NULL DEFAULT 0;
