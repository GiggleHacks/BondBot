-- Sounds play unless a person turns them off. The switch was off for everyone before, so no
-- earlier choice of silence is lost by turning it on.
ALTER TABLE "user" ALTER COLUMN "notificationSounds" SET DEFAULT true;
UPDATE "user" SET "notificationSounds" = true WHERE "notificationSounds" = false;
