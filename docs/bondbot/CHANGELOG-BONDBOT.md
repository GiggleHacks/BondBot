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
