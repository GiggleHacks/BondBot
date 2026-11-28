# BondBot changelog

Version is shown at the top left of the sidebar (apps/web/src/lib/bondbot-version.ts). Bump it on every deploy.
Format: major.minor.patch (patch = small fix, minor = new feature, major = big change).

## Server-side (2026-11-21, no UI version bump)

- Auto-pay: with a spending limit set, a pay click that the limit allows no longer asks 'Pay on <site>?' (run-tool-gate.ts, autoPaid). Saved-card and saved-login approvals still ask. The limit still refuses anything over it, in another currency (limit currencies are only usd/eur/gbp/ils) or whose price cannot be read, and counts the click just before the press. With NO limit set, paying still asks every time. Limit set by David: 1.00 USD in total (period none; Settings can change it). DB row in spending_limits; patch in ui-autopay-20261121/. Rollback tag: pre-autopay-20261121 (and delete the spending_limits row to restore the old behaviour fully).

## v0.1.12 (2026-11-21)

- Model dropdown: tap the model icon in the chat header; Most used (top 3 by runs in the last 30 days) then All models (connected models), current ticked, each with a tiny High. Tap one to switch that bot. Rows dim and the tapped one shows pixel dots while the server saves; on failure a pixel x and a message, nothing changes.
- Pixel animation (about 0.45 s, canvas): plays ONLY after the server has confirmed the switch (rpc.bots.update resolved): old icon breaks into big pixels, new icon sharpens, pixel wipe along the screen edges in the maker's colour, pixel tick, short buzz. Respects reduced motion.
- Faint edge colour around the chat per model maker: Anthropic orange, DeepSeek blue, Grok text-colour (silver on dark, black on light); others none. Setting 'Model colour around the chat' in Account settings turns it off.
- Chat note: after a saved switch the server adds a textless system message {kind: model_switch} ('Switched to Claude Sonnet 5.5 · High' with the maker's icon and time). It has no text so the model never reads it. Best effort: failing to add it never undoes the switch (logged as bot.model_switch_note_failed).
- New API: botModels.mostUsed (routes/model-usage.ts); new block kind model_switch in contracts; recordModelSwitch in apps/api/src/model-switch-note.ts, called from bots.update. Files in ui-modelswitch-20261121/; browser test 30/30 + logic tests. Rollback tag: pre-modelswitch-20261121.

## v0.1.11 (2026-11-21)

- Removed the emoji reaction (smiley) button from the action row under messages (message-hover-actions.tsx, SHOW_REACTION_BUTTON = false; flip to true to bring it back). Row is now Reply, Copy, More. Browser test 11/11 in ui-removeemoji-20261121/. Rollback tag: pre-removeemoji-20261121.

## v0.1.10 (2026-11-21)

- Dedicated Copy button in the action row under every message (React, Reply, **Copy**, More): one tap copies the message text, the icon flips to a tick for ~2s; the More button no longer turns into the tick. Messages with nothing to copy (a lone image) get no Copy button. message-hover-actions.tsx; patch + 10-check real-browser test (incl. real clipboard) in ui-copybutton-20261121/. Rollback tag: pre-copybutton-20261121.

## v0.1.9 (2026-11-21)

- Phone Back gesture: Back now closes the newest open layer instead of leaving the app: docked-screen full screen, then the side panel, the computer window, the menu, and settings/other overlays (each open layer owns one browser history step; closing in the app removes it, so no phantom Back press). lib/back-layers.ts (manager + useBackLayer), wired in Shell.tsx and DockedScreen.tsx. Overlays (URL-driven) now add a history entry when opened and step back when closed by hand (use-shell-navigation.ts); opened by reload/deep link they behave as before. Phone widths only. Patch + 19-check real-browser history test in ui-backgesture-20261121/. Rollback tag: pre-backgesture-20261121.

## v0.1.8 (2026-11-21)

- Phone split view: monitor button in the chat header docks the live screen above the chat. Drag the grip divider up/down (84px minimum, 70% of the view maximum, 40% while the keyboard is up; height remembered), full-screen button (x closes, Chat returns to the split, Escape also exits), x closes the dock. View-only; a sleeping computer shows a message and a Wake button. The screen now loads while docked (use-computer.tsx `docked` option) and the bot panel takes over frame reporting while it is open. Files: pages/shell/DockedScreen.tsx, lib/screen-dock.ts, chat-header.tsx, Shell.tsx, use-computer.tsx; patch + browser test (29/29) in ui-splitview-20261121/. Rollback tag: pre-splitview-20261121.

## v0.1.7 (2026-11-20)

- Chat header: VPN chip is icons only (status dot, shield, country flag; no 'VPN LOCKED' / 'SG' words - the status is still its tooltip and screen-reader label; colour/icon show locked/blocked/fallback/direct). New round model chip between the VPN chip and the bot chip showing the model vendor logo (tap opens the bot panel). Bot panel / sidebar chips unchanged. Files: chat-header.tsx, computer-vpn-control.tsx (iconsOnly prop), ModelBrandIcon.tsx (className prop); patch + browser test in ui-header-20261120/ (16/16). Rollback tag: pre-header-20261120.

## v0.1.6 (2026-11-20)

- Reasoning now streams LIVE while the bot thinks (label 'Thinking...', follows the newest line), above the reply that streams in below it; the saved reply keeps it as the first block, labelled 'Reasoning'. Worker publishes chunks (350 ms, cut at spaces, secrets redacted) as thread.progress {reasoning} events (transient, pruned after the run); core reducer keeps one growing reasoning block first; avatar 'thinking' state not disturbed. Files: reasoning-capture.ts (takeReasoningChunk), run-turn.ts, core/events.ts, core/logo-avatar-activity.ts, message-view.tsx; patch + tests in ui-livereasoning-20261120/. Browser-tested with the real MessageView (10/10). Rollback tag: pre-livereasoning-20261120.

## v0.1.5 (2026-11-20)

- Voice notes (any audio attachment) now look like Telegram voice notes: round play/pause button, real waveform, elapsed / total time, tap or drag the waveform to seek, 1x / 1.5x / 2x speed (sticks), arrow keys +-5s, one note plays at a time, download icon kept, file name only on hover. Loads as it scrolls into view (files over 8 MB wait for play). Files: components/VoiceNotePlayer.tsx, lib/voice-note.ts; patch + browser test in ui-voicenote-20261120/. Tested in headless Chromium (14/14). Rollback tag: pre-voicenote-20261120.
- Note for future UI work: new user-facing strings must NOT use the lingui t`` macro (production builds show the message id like "rQJzEg" unless the catalog has it); use plain strings.

## v0.1.4 (2026-11-20)

- Fix: the Reasoning block was captured and saved but never drawn for normal replies (text + reasoning go through the narration renderer, which skipped the reasoning kind). Now drawn there too (patch10-narration-reasoning.mjs). Rollback tag: pre-narrreason-20261120.

## v0.1.3 (2026-11-20)

- Computer preview (and full window): tiny LIVE / fps badge bottom-right. Green `LIVE 24 fps` = connected + measured frames per second; `LIVE 0 fps` = connected but screen idle; amber CONNECTING / RECONNECTING; red OFFLINE = picture is frozen. Injected into the noVNC page by the proxy (apps/web/src/novnc-html.ts); patch: ui-brand-20261120/patch/patch8-livebadge.mjs. Rollback tag: pre-livebadge-20261120.
- v0.1.3 hotfix: the first badge build wrapped WebSocket in a subclass, which noVNC rejects ("Raw channel missing property: send"), so the computer screen went blank. Fixed by returning a genuine WebSocket (patch9-livebadge-fixed.mjs). Tested in headless Chromium against the real desktop and an animated screen (26-40 fps).

## Server-side (2026-11-20, no UI version bump)

- Thinking is always on for OpenAI-compatible models (Supports thinking switch no longer matters); inline <think>..</think> in a reply is moved into the Reasoning block.
- Every reasoning-capable model always runs at high effort (thinkingLevelFor in pi-runtime-models.ts ignores the per-bot setting). Rollback tags: pre-thinkon-20261120, pre-higheffort-20261120.

## v0.1.2 (2026-11-20)

- Add dedicated-computer Monitor badge above the sidebar VPN chip (sky-blue when running, muted when asleep; top-left avatar corner in collapsed mini mode).

## v0.1.1 (2026-11-20)

- Fix: BondBot mark now sits at the far left of the sidebar header in the browser/phone (an invisible 72px desktop-window spacer was pushing it to the middle).

## v0.1.0 (2026-11-20)  first numbered version

- BondBot wordmark in the Quake 1 console font (top left of the sidebar) with the version underneath; collapsed sidebar shows only the B.
- Model-vendor icon left of each bot's name (Claude "A", Grok X, DeepSeek whale, ...); smaller VPN chip.
- Reasoning dropdown under bot replies (small grey text, open by default, tap the heading to fold). Settings > Show reasoning. Captured for all bots (/data/reasoning-bots.txt).
- Fix: voice notes failed with a non-integer timeout ("delay is out of range").
- Fix: bot list failed to load after adding model info to the roster (spaces route now includes it).
- Local patches from before: bots can use sudo; bot traffic through the Proton VPN with kill switch; bot homes on the array disk; local speech-to-text.

## 0.1.13 (2026-11-21)

- Chat note "Switched to ... · High" made smaller (10.5px, 18px pill) and centred; time moved to tooltip. Files: ui-noteslim-20261121/. Rollback tag: pre-notesmall-20261121.

## 0.1.14 (2026-11-21)

- Model switch animation replaced: pixel effect -> a quick (0.38s) glowing scan line sweeping down the whole page in the maker colour; chip icon swaps as the line crosses it. Files: ui-scanfx-20261121/. Rollback tag: pre-scanfx-20261121.

## 0.1.15 (2026-11-21)

- Voice notes: bubble appears in the chat the instant you release (thin, same size as the player), status underneath: Offline · will send when connected -> Sending -> Transcribing (animated waveform + dots), retry/delete on failure. Player made thinner (260px wide, 48px tall). The old strip above the composer is hidden (SHOW_IN_COMPOSER=false in VoiceNoteQueue.tsx). voice-notes.ts: new snapshot field finishing. Files: ui-voicepending-20261121/. Rollback tag: pre-voicepending-20261121.

## 0.1.16 (2026-11-21)

- Split view: Wake and Retry screen now act inside the dock instead of opening the full-screen computer. use-computer.tsx (dockedRef), use-computer-controls.tsx (openComputer inPlace flag, Retry), Shell.tsx (onWake). Files: ui-dockwake-20261121/. Rollback tag: pre-dockwake-20261121.

## 0.1.17 (2026-11-21)

- Split view: a Refresh button is always in the dock (corner icon next to Full screen/Close, plus a middle Refresh when the pane says Connecting to the screen and has no Wake/Retry). Wakes a stopped computer or reconnects a running one, in place, never full screen; frees itself after 6 s if the screen read hangs. Files: ui-dockrefresh-20261121/ (patch22.mjs then patch22b.mjs). Rollback tag: pre-dockrefresh-20261121.

## 0.1.18 (2026-11-21)

- Split view screen: pinch to zoom like a photo (1x-5x), one finger pans when zoomed, double-tap zooms 2.5x in/out, small 1x chip resets; also in the docked full-screen view. View-only dock only (the control overlay is unchanged). touch-action none on the screen area. Files: ui-pinchzoom-20261121/. Rollback tag: pre-pinchzoom-20261121.

## 0.1.19 (2026-11-22)

- Connection signal bars in the header (right side): 3 green = live, 2 amber = slow/reconnecting, 1 red + slash = offline. Pings /api/auth/ok every 10 s (3 s after a failure), also watches live streams (follow-stream.ts reports open/close) and the browser online flag. Tap = instant check + panel (speed, last answer, Tailscale hint). Files: lib/connection-status.ts, components/ConnectionBars.tsx, chat-header.tsx, follow-stream.ts; tests in ui-connbars-20261122/. Rollback tag: pre-connbars-20261122.

## 0.1.20 / 1.6.1 (2026-11-23)  audit fixes (items 1-11)

- Kill Switch (host VPN manager): lock rules are installed before tunnels come up; one bad profile is skipped instead of stopping the manager; all firewall rules apply in one atomic iptables-restore (-w) with return codes checked; empty/oversized/invalid request bodies are rejected (they used to mean "no VPN, unlocked"); state file is fsynced with a .bak fallback; reconcile never drops a lock that is absent from the payload; the status port (5174) serves read-only GET only with a Host check, country values are validated and the dashboard no longer uses innerHTML; the socket server is threaded with a timeout.
- Locks: moving a bot with a locked Kill Switch to the Team computer is refused; locking/choosing a VPN needs restricted computer egress and SANDBOX_COMPUTER_DNS (so DNS cannot leak around the kill switch).
- Voice notes (server): uploads are capped by the declared size and 20 open notes per user; assembly streams from disk; ffmpeg has a duration limit, a protocol whitelist and a kill-on-abort; at most 2 decode jobs at once; orphan audio and old failed notes are swept; live transcription skips needless re-decodes; duplicate declares and deletes are race-safe; errors shown to members no longer contain paths.
- Voice notes (app): a failed storage write no longer leaves the mic on; IndexedDB failure falls back to memory; interrupted capture is saved and sent; hold-to-talk releases on blur; deleting an uploading note cancels it; requests have timeouts and backoff; AbortSignal.timeout replaced for older iPhones; 401/403 pause the queue instead of failing notes.
- About 40 strings that showed raw ids in production are now plain text (voice notes, VPN menus, Show reasoning).
- Speed/housekeeping: index on runs(userId, createdAt); polling pauses when the tab is hidden; /health no longer logged on success; dead VoiceNoteQueue mount removed.
- Rollback tag: rakazo-voice:pre-audit-20261123. Host VPN manager backup: /boot/config/rakazo-vpn-manager.py.bak-20261123.

## 0.1.21 / 1.6.2 (2026-11-24)  audit fixes & optimizations

- Uploads & outbox (web): fixed `xhrSend` hanging on HTTP `204 No Content` responses (voice note part uploads) and leaking abort listeners; `SendQueue` now schedules backoff retry timers, scopes `threads.send` to the queued item's Space, and triggers session recheck on 401; `PendingOutbox` allows cancelling `confirm` items, shows Retry on backed-off items, and displays non-image filenames.
- Voice notes (web + api): `/api/voice-notes/:clientId/complete` now validates, deduplicates, and writes companion attachments _before_ marking the note `queued` (only while `uploading`); server `assemble()` streams through a single file handle, reuses the assembled `source` file instead of concatenating twice, and skips redundant `advance()` calls on post-send part PUTs; client fixes progress double-counting, per-note companion failure isolation, in-flight part XHR cancellation on discard, companion staging during mic init, map cleanup, and server-side `sending` status display; removed dead `VoiceNoteQueue.tsx` and unused `liveUpload` code.
- Docked screen & UI: closing the docked screen now releases computer control and stops keep-awake pings; cleared stale tap timers across bot switches; enabled desktop mouse click-to-control and zoom reset on takeover; fixed duplicate SVG clipPath IDs for Brazil flags; `/host-stats` now requires a session cookie, handles missing `/proc` safely, and caches samples for 1.5s.
- Host VPN manager & bot lifecycle: batched WireGuard/link status queries (`wg show all dump` + `ip link show`) outside `LOCK`; preserved `PROBE_CACHE` and running state when `docker ps` fails; checked return codes in `ensure_tunnel_up()`; cleared dedicated VPN bridge rules when a bot is deleted; dynamic host country labels in VPN popover.
- Voice player, reasoning, & polling: `VoiceNotePlayer` shares one `AudioContext` with a 2-slot decode queue, resets cleanly on `artifactId` changes, syncs `sharedSpeed` across players, and updates duration on `loadedmetadata`; `reasoning-capture` always strips inline `<think>` blocks, drops empty text blocks, runs the live streaming timer only while thinking, and cleans buffers on abnormal exit; paused hidden-tab timers (`ConnectionMonitor`, noVNC live badge, idle voice-note sweeps), stabilized `setBotVpn`, silenced `/api/auth/ok` and supervisor `/health` OK logs, and fixed the two pre-existing TS errors (`ModelSwitcher.tsx:55`, `voice-note.ts:21`).

## Rakazo base update to v0.16.0 (2026-11-25, not deployed, no version bump)

- Merged upstream v0.16.0 (was 572755b41) into cccbox v0.1.22 and ported the patches into upstream's new file layout.
- Dropped because upstream covers it: the compact "Awake" row, the dock Retry workaround, computer-mode-switch.ts (the Kill Switch unlock guard moved into switchBotComputer).
- Type-check and build pass. Unit tests still failing are ones that already failed before the merge or on upstream, or that expect behaviour BondBot changes on purpose (always-high effort, forced thinking, separate Copy button, hidden Voice tab, untranslated Thai strings). Not checked in a browser; no Docker image built.
- Before deploying: back up the database (upstream drops some computer execution columns). cccbox's patch-in-place recipe in LOCAL-PATCHES.md does not fit a base change; build a full image from infra/compose/Dockerfile.
- Ported the file Share button (phone share sheet) that was live on cccbox but built from an older tree, so it was missing from the 0.1.22 sync.
- Moved the sidebar CPU/RAM widget (host-stats.js) into the source; on cccbox it had only been hand-added to the built page.

## Deployed to cccbox (2026-11-25 19:27 ICT)

- Rakazo v0.16.0 base is live. Images rakazo-voice:v016-20261125 (tagged :local) and rakazo-computer-sudo:v016 (tagged :local), both built off the server and loaded with docker load.
- New compose file from v0.16.0; sudo override is overrides/computer-spec.v016.ts. 41 migrations applied (rehearsed on a copy first).
- Verified: health, web, 332 migrations, throwaway computer boot (sudo, internet, LAN blocked), speech-to-text reachable. Not exercised: a real bot run, voice notes, VPN switching, phone layouts.
- `content-encryption migrate` (upstream 0.14 note) has NOT been run, to keep rollback simple.
- Rollback: bash /mnt/user/appdata/rakazo/backup-pre-v016-20261125/rollback.sh (loses data written after the deploy).

## 0.2.0 / 1.7.0 (2026-11-25)  landing, pixel effects, profile photo, themes

- Sign-in / sign-up landing: everything centered on black. The BondBot skull (apps/web/public/brand/bondbot-landing-robot.webp, pixel art with blue eyes) sits at the top: faint scrambling Quake-font code fills the screen, then the skull forms outward from its eyes in about 2.5 s, each glyph scrambling and settling into a solid pixel in the picture's own colors (contrast raised, slightly darker). Idle: every 6 s a band of it breaks back into code and re-forms; rare single-glyph glitches. A very faint wall of scrolling code sits behind, faded out in the middle. Below: the "BOND BOT" wordmark (blue glow; letters drop in one by one, then a shimmer runs along it every few seconds), then the form. Reduced motion draws everything once. Files: pages/auth/landing/ (robot-ascii.ts pure, RobotBackdrop.tsx, CodeBackdrop.tsx, code-lines.ts, landing.css), AuthFrame in pages/auth/Auth.tsx, components/brand/QuakeText.tsx (moved out of BondBotMark). "Sign in to Rakazo" is now "Sign in". Desktop first-run screen and og tags say BondBot.
- Favicon and app icons (favicon.ico/png, apple-touch-icon, icon-192/512) are the skull's face, pixelated.
- PIN instead of a password (web + desktop screens): "Use a 6-digit PIN" under the password field on sign-up and sign-in. Typing it plays real touch-tones per digit and a short dial-up modem handshake when complete (components/account/PinInput.tsx, lib/fx/dial-tones.ts, Web Audio, no files). The PIN is the account password: stored and checked the same way, no schema change. Server (packages/auth/src/pin-password.ts): new passwords must be 8+ characters or exactly 6 digits; one digit repeated and straight runs (000000, 123456) are refused; 5 wrong PINs for an email address lock PIN sign-in for it for an hour, counted across instances with Verification rows, on top of the per-IP limits; /change-password is rate limited too. A PIN is much weaker than a password: keep this server off the public internet. Mobile has no PIN pad, but a PIN typed into its password field works.
- Pixel effects: pixel trail behind the mouse (components/fx/pixel-fx.ts, loaded after first paint) and a stepped flicker/lift on hover (styles/pixel-fx.css). Settings > Preferences > Pixel effects turns both off on that device (localStorage bondbot.pixelFx); reduced motion also turns them off; touch never draws.
- Profile photo: Settings > Account > Photo (click or drop an image; Remove photo). Cropped to a 192px webp in the browser and saved on the account (better-auth user.image). The account menu header shows the photo and opens Settings. Mobile profile screen has a Photo row (pick + square crop, remove). Server rejects anything but empty, https URLs, or png/jpeg/webp/gif data URLs up to 200k characters (isUserImageValue in contracts; auth user create/update hooks). `me` now returns `image`.
- Themes: Appearance now offers System, Light, Dark, Dark blue and Dark purple (web dropdown, command palette, mobile menu). Tinted palettes are data-palette blocks in tokens.css generated from darkPaletteOverrides in ui-tokens.

## Deployed to cccbox: 0.2.0 (2026-11-25 20:48 ICT)

- Image rakazo-voice:v020-20261125 (tagged :local), built off the server from f2cbef845 and loaded with docker load. api, web, worker and supervisor recreated. No schema change.
- Rehearsed on cccbox first against a throwaway Postgres: easy and short passwords refused, PIN sign-up and sign-in, lockout after five wrong PINs.
- Verified live: services healthy, v0.2.0 in the sidebar, Settings shows Photo, the theme list and Pixel effects. Not exercised: the signed-out landing on the live server, photo upload, a bot run.
- Rollback: bash /mnt/user/appdata/rakazo/backup-pre-v020-20261125/rollback.sh (image pre-v020-20261125; a database dump from just before is beside it).

## v0.2.1 (2026-11-26)

- "Rakazo" is now "BondBot" in what people read: web screens and notices, the installed web app's name, desktop window and dialog text, account emails, passkey and authenticator labels, meeting names and notices, and server error messages.
- Translated text is renamed where it is shown (core `rebrand`/`rebrandCatalog`, hooked into web catalog loading, desktop `t()` and email text), so catalogs and message ids are untouched and upstream merges stay clean. Plain English strings were edited directly.
- Removed the "Enjoying Rakazo?" GitHub star prompt, which pointed at the upstream repository.
- Left as Rakazo on purpose: "Rakazo Cloud" (upstream's hosted service), the mobile app, the desktop app's installed name, bot instructions and the built-in "Rakazo" help skill, web addresses, package names and ids.
- Fixed: three desktop menu messages had lost their translations (their keys had been edited to "BondBot"); they use the original keys again and are renamed when shown.

## Deployed to cccbox: 0.2.1 (2026-11-26 05:54 ICT)
- Image rakazo-voice:v021-20261126 (tagged :local), built off the server from the 0.2.1 working tree on top of 283ad475a (not yet committed at deploy time). api, web, worker and supervisor recreated. No schema change.
- Rehearsed against a throwaway Postgres: PIN and password sign-up and sign-in, and the PIN lockout.
- Verified live: services healthy, no error logs, API reports 1.7.1, page title and installed app name say BondBot, served files carry 0.2.1 and the rename step. Not checked on screen: Chrome could not open the site.
- Rollback: bash /mnt/user/appdata/rakazo/backup-pre-v021-20261126/rollback.sh (image pre-v021-20261126; a database dump from just before is beside it).

## v0.2.2 (2026-11-26)
- The pixel cursor trail now shows only on the sign-in screens (sign-in, sign-up, password reset, join organization) and is removed once you are in. AuthFrame starts and stops it (components/fx/pixel-fx.ts). The hover flicker is unchanged, and Settings > Pixel effects still turns both off.

## Deployed to cccbox: 0.2.2 (2026-11-26 06:12 ICT)
- Image rakazo-voice:v022-20261126 (tagged :local), built off the server from the uncommitted 0.2.2 working tree on top of 283ad475a. api, web, worker and supervisor recreated. No schema change.
- Rehearsed against a throwaway Postgres (PIN and password sign-up, sign-in, lockout). Verified live: services healthy, no error logs, API reports 1.7.2, served files carry 0.2.2. Not checked on screen.
- Rollback to 0.2.1: bash /mnt/user/appdata/rakazo/backup-pre-v022-20261126/rollback.sh

## 0.2.2 follow-up fixes (2026-11-27, no version bump)
- Image uploads from the send queue failed with "Upload failed (400)": lib/send-queue.ts posted a plain JSON body to `/rpc/artifacts/create`. The RPC server expects `{ json, meta }` and answers `{ json }`; the upload now wraps the request and reads replies and errors from inside it.
- Docked screen reconnects by itself: when the screen of a RUNNING computer shows "Screen not connected", it retries when the app returns to the foreground, the network comes back, and on a 2/4/8/16/32 s backoff, then waits for a retry from the user. A stopped computer is never woken (pages/shell/computers/use-computer-controls.tsx).
- Long voice notes could fail with "The value of delay is out of range": the transcription timeout was not a whole number when the file size was not divisible by 3. It is now rounded up (apps/api/src/voice-notes.ts).
- Voice note player made into a compact pill (components/VoiceNotePlayer.tsx) and audio attachments ordered above their transcript text in `MessageView` (pages/shell/chat/message-view.tsx).

## v0.3.0 / 1.8.0 (2026-11-27)
- Multiview: view 2, 3, or 4 bot computers at once on desktop (`2 cols`, `3 cols` or `1 featured + 2 stacked`, `2x2` grid), and max 2 stacked screens on mobile with pill/swipe paging when 3 or 4 are configured.
- Each tile shows a live screen (view-only by default; button or double-click takes control with bot-busy confirmation and an animated focus glow), bot swapper, `Maximize`, and a `More` menu with `Wake computer` / `Turn off computer`, `Refresh screen`, `Save screenshot`, `Open full screen`, `Open full chat`, model switcher, VPN controls, and tile removal.
- Each tile includes a collapsible, drag-resizable mini chat underneath with live replies, send/stop composer, and inline approval cards.

## v0.4.0 / 1.9.0 (2026-11-27)
- In-app BondBot update indicator: checks `GiggleHacks/BondBot` `main` on GitHub and shows a crisp red notification dot on `BONDBOT` in the sidebar (and mobile navigation button) for workspace owners/admins when a newer version is available.
- Clickable update popover with version comparison (`vCurrent -> vNext`), changelog notes, optional `Skip` per version, and 1-click update with an animated progress bar (`Checking GitHub` -> `Downloading` -> `Building` -> `Migrating` -> `Restarting` -> auto-reload).
- Works across both Docker Compose deployments (via the `updater` sidecar `/bondbot/status` and `/bondbot/apply` endpoints) and local git checkouts (`git pull --ff-only`, `pnpm install`, `pnpm build`).

## v0.4.1 / 1.9.1 (2026-11-27)  Rakazo base update
- Merged upstream Rakazo main (164 commits after v0.16.0, up to ff3f24666; no newer upstream release exists) into BondBot 0.4.0. All BondBot features, names and looks are kept.
- New from upstream, among others: organization vault and shared sign-ins, organization model connections, shared skills/plugins/MCP servers/app connections, bot API keys with an API, MCP server and CLI, app icon picker, image rows with a cached lightbox, option cards for questions, read-aloud moved into the message menu, line breaks in replies, settings layout cleanup, many fixes. 15 new migrations (additive).
- Conflicts resolved by keeping BondBot behaviour: forced thinking for OpenAI-compatible models now sits on top of upstream's new compatible-model defaults; the five-theme Appearance dropdown is kept over upstream's three-way toggle; voice notes, VPN reconcile, Windows download and the BondBot README are kept; the server image installs ffmpeg plus upstream's fonts; desktop app id stays BondBot and takes upstream's new launcher entry.
- Fixed while merging: the authorization test now covers the 0.4.0 updater routes, and the generated standalone Compose file includes the 0.4.0 updater settings.
- Checked: type-check passes in every workspace (mobile included); Biome and the repo checks show nothing new beyond BondBot's existing baseline. Unit tests: every failure was either already failing on 0.4.0 or is an upstream test expecting behaviour BondBot changes on purpose (always-high effort, forced thinking, auto-pay under a spending limit, ElevenLabs hidden). One more fails only because of an ignored local `packages/i18n/locales/messages.pot`.

## Deployed to cccbox: 0.4.1 (2026-11-27)
- Image rakazo-voice:v041-20261127 (tagged :local), built off the server from c2a98805c and loaded with docker load. New docker-compose.images.yml from the repo (three new optional settings). api, web, worker and supervisor recreated; the sudo computer override and the speech server are unchanged and still work.
- Rehearsed first on a copy of the live database: the 15 new migrations applied (338 to 353), and the new API, booted on a network with no internet, passed health, refused an easy PIN, and handled PIN and password sign-up and sign-in.
- Verified live: services healthy, no error logs, 353 migrations, API reports 1.9.1, the web bundle carries 0.4.1, page title BondBot, speech server reachable. Not exercised: a real bot run, voice notes, VPN switching, the new organization features, the screen in a browser.
- Rollback: bash /mnt/user/appdata/rakazo/backup-pre-v041-20261127/rollback.sh (image pre-v041-20261127; a database dump from just before is beside it).

## v0.5.0 / 1.10.0 (2026-11-28)
- Multiview: the divider between a screen and its chat drags, scrolls (wheel up gives the chat more room) and takes arrow keys, up to nearly the whole tile. A second layout, picked in the Multiview header, gives each bot a full-height chat column with its screen as a small window at the top end (click it for full screen; it can be hidden). That column's composer is text only.
- Wake in the bot panel starts the computer where it is. A separate Full screen button on the preview opens the full window.
- Sleeping bots are drawn grey with a moon (sidebar, chat header, Multiview). The roster is re-read when a computer wakes or stops.
- The bot panel shows the computer's memory and processor use faintly under the name (Docker computers). Read on opening and focus, never polled. Needs the updated supervisor.
- "Connect apps" left the foot of the sidebar; it is now Settings > Integrations (the command palette entry stays).
- Hover no longer flickers or lifts, which is what made the VPN chip jump; hover scaling is gone too. The "Pixel effects" setting is removed; the sign-in cursor trail stays and follows reduced motion.
- Sounds while bots work (message sent, soft ticking while a reply streams, working, needs you, error), turned on with Settings > Play sounds while bots work, now in browsers too. The app's own sound replaces the system notification sound. The sounds are synthesized for BondBot.
- Linux desktop app uses the desktop's own window frame and buttons, and can be packed as BondBot.AppImage (pnpm --filter @rakazo/desktop pack:linux).
- Scrollbars follow the theme.
- Sign-in page is smaller and holds still: the robot and the BOND BOT wordmark are drawn once.
- Checked: type-check passes (the two old billing errors aside); unit tests and repo checks match 0.4.1's failures; 87 targeted browser tests pass and 4 fail the same way on 0.4.1. Not heard or seen on a real server before deploy: the sounds in a live chat, real memory and CPU figures in the panel.


## Deployed to cccbox: 0.5.0 (2026-11-28 07:51 ICT, by the in-app updater)
- Updated with the app's own Update button (image built on cccbox from 1771c3aaf, about 6 minutes). Database dumped to /mnt/user/appdata/rakazo/backup-pre-v050-20261128/ while it built; no schema change.
- Verified live: api, web, worker and supervisor healthy, API reports 1.10.0, the three compose files and the sudo computer override are in use, speech server reachable. One expected "run.queue_delayed" during the restart.
- Seen: the update screen stayed at "Reconnecting 94%" although the server had finished (fixed in 0.5.1).
- Rollback: bash /mnt/user/appdata/rakazo/backup-pre-v050-20261128/rollback.sh

## v0.5.1 / 1.10.1 (2026-11-28, not deployed)
- Updates: the red dot is gone. An "Update to vX" button with Skip sits above the CPU and RAM meter. While updating it shows a checklist (download, build, database, restart), a moving bar, size and speed while downloading, time left (from the last update's length), the current build step, and that refreshing is safe.
- Fixed: the page stayed at 94% for ever after a successful update, because it waited on /health, which the web server does not answer with JSON. It now follows the update's own record and reloads when that says finished. A page loaded during an update picks it up.
- The updater sidecar reports live progress. It does not update itself: rebuild and replace its image once (rakazo-updater) for speed, time left and build steps.
- Sounds are on by default (migration turns them on for existing accounts, which also turns on phone push sounds). Each kind has its own switch in Settings > General > Notifications. Thinking ticks are far quieter and sparser, the tool burst quieter, and the send, tool and thinking sounds have four versions each.
- Settings > General has two optional looks, both off by default and kept per device. "Colorful chat" colours thinking, tool steps by what they touch (red when one failed), headings, emphasised words, code, links, quotes and errors. "Terminal font" uses Cascadia Mono where installed and the device's monospace elsewhere. The Dark blue theme goes well with it.
- The bot panel's reading is now "RAM 1.2 GB  CPU 8%", green, amber or red by how full it is.
- Linux (and Windows) desktop with the system window frame: the logo is at the far left again; the room for macOS window buttons is no longer reserved.
