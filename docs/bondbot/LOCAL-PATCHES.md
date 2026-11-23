# BondBot (patched Rakazo)

BondBot is a patched build of [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0). Upstream base commit: `572755b41` (2026-11-16). The `bondbot` branch is that commit plus every local change in one commit; `git diff 572755b41..bondbot` shows exactly what was changed.

Notes below are the author owner notes. Paths, image names and rollback tags refer to the original Unraid deployment and need adapting. Do not paste API keys into this repo.

---

# Rakazo local patches (David) - read before updating or rebuilding anything

The stack runs the locally committed image `rakazo-voice:local` (.env: RAKAZO_IMAGE=rakazo-voice, RAKAZO_IMAGE_TAG=local).
Pulling an upstream image or changing those two lines DROPS every patch below. Re-apply from the patch scripts, then rebuild.

## Always-on rules David asked for (universal, forever, all bots incl. new ones)
1. Every reasoning-capable model always runs at HIGH effort. packages/adapters/src/pi-runtime-models.ts thinkingLevelFor() ignores the per-bot setting. (patch: reasoning-20261120/patch/patch7.mjs)
2. Thinking is always ON for OpenAI-compatible models (connectionModelSettings in model-settings.ts forces reasoning:true). (patch6.mjs)
3. Reasoning is captured for ALL bots and shown under replies (grey, open by default, foldable). /data/reasoning-bots.txt must contain `*` (it lives on the data volume). Inline <think>..</think> in a reply is moved into the block. (reasoning-capture.ts, patch6.mjs)
4. Live badge: tiny LIVE/fps pill in the computer preview, injected via apps/web/src/novnc-html.ts (needs a web container restart to load; patch8-livebadge.mjs).
5. UI: BondBot Quake wordmark + version (ui-brand-20261120), model-vendor icons (ui-model-icons-20261120), Monitor badge (v0.1.2).

## How to deploy a change (gotcha learned 2026-11-20)
Build in a scratch container from rakazo-voice:local, docker cp the new files into the running containers, restart, then
BEFORE `docker commit rakazo-api-1 rakazo-voice:local` sync ALL THREE sets of files into rakazo-api-1 (commit is taken from api):
  worker: /app/apps/worker/dist + /app/packages/adapters/src  (from rakazo-worker-1)
  web:    /app/apps/web/dist + /app/apps/web/src              (from rakazo-web-1)  (use `docker exec -u root` for rm)
  api:    /app/apps/api/dist
Otherwise a container recreate silently reverts the other services. Verify with `docker run --rm --entrypoint sh rakazo-voice:local -c "grep -c ... "`.
Rollback tags: pre-thinkon-20261120, pre-higheffort-20261120, pre-left-20261120, pre-brand-20261120, pre-reasoning-v2-20261120, pre-reasoning-20261120, pre-modelicons-20261120.
Changelog: CHANGELOG-BONDBOT.md (bump apps/web/src/lib/bondbot-version.ts on UI deploys).

GOTCHA: do not use the lingui t`` macro for new strings in local patches - production builds show the message id (e.g. rQJzEg) because the catalogs do not contain them. Use plain strings.
GOTCHA: test UI changes in headless Chromium before deploying (harness recipe in ui-voicenote-20261120/: vite harness config + cdp_vn.py).

AUTO-PAY (2026-11-21): run-tool-gate.ts autoPaid (patch18.mjs in ui-autopay-20261121/) + a spending_limits row (1.00 USD total) for David's user. Re-apply both after an upstream update; without the row paying asks every time.

MODEL SWITCH (2026-11-21): patch19.mjs in ui-modelswitch-20261121/ touches contracts (model_switch block, botModels.mostUsed), api (routes/model-usage.ts, model-switch-note.ts, bots.ts, router.ts) and the web header/Shell/message-view. Re-apply after an upstream update; rebuild api, worker and web.

## VPN manager: forgive one failed internet check (2026-11-21)
- File: /boot/config/rakazo-vpn-manager.py (host daemon, started from /boot/config/go). Backup: rakazo-vpn-manager.py.bak-20261121 (in /boot/config and here).
- Why: a single slow/failed `curl` probe (every ~12s) flipped a computer to "blocked" in the UI while the tunnel was fine (seen on YouTuber1 under heavy load, 04:10 UTC).
- Change: a computer shows "blocked" only after 3 probe failures in a row (FAIL_TOLERANCE); probe curl --max-time 6; each failed probe is logged to /var/log/rakazo-vpn-manager.log with the reason. Tunnel-down and kill switch (iptables) logic untouched; policy changes (set/reconcile) are never smoothed.
- Re-apply / test: vpnfix-20261121/patch.py <orig> <new>; test.py <file> (10 checks). Restart: kill -TERM the python3 pid, then run the go-file line.
- Known, not changed: apply_iptables_policies() flushes then re-adds the KS/MANGLE chains every loop (non-atomic), a millisecond-scale gap. Could be made atomic with iptables-restore.
