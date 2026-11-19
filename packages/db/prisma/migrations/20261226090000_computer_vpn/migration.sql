-- Add per-computer Proton VPN profile and fail-closed kill-switch lock.
ALTER TABLE "computers" ADD COLUMN "vpnProfile" TEXT;
ALTER TABLE "computers" ADD COLUMN "vpnLocked" BOOLEAN NOT NULL DEFAULT false;
