# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
FireOS-Inox is a Fire TV client, targeting **Vega OS** with **React Native for Vega**, for Inox, a synchronised watch-party platform. It's being built for the "Build, Ship, Shape" Amazon Developer Hackathon (Fire TV track + AWS Builder mini-challenge). **Deadline: Fri 2026-10-23 12:00 PT.**

**Start every session with `docs/00-START-HERE.md`, then the latest entry in `docs/dev/session-log.md`.** The docs are local only (`/docs` is git-ignored) and hold the plan, the decisions, the exact Inox API/WS contract, and the setup steps.

## Hard rules
1. **Inox is read-only.** `/home/robin/code/go/inox` is the reference implementation.
   - Never edit, build, install, run or `make` anything inside it.
   - Never run writing git commands there; use `git --no-optional-locks` for reads.
   - Use the snapshot in `.devstack/inox-src` (see `docs/dev/local-stack.md`).
   - Run `scripts/check-inox-untouched.sh` at the end of each session.
2. **Never contact the deployed Inox backend.** Use only the local isolated stack (ports 15432/16379/18080/15173, compose project `fireos-inox-dev`).
3. **Test and demo target is the Vega Virtual Device.** There is no Fire TV hardware.
4. **No `.env` file at the repo root.** Inox's config loader reads `.env` from parent directories.
5. **Don't invent.** Vega API and package names, commands and results are unverified until checked against the installed SDK or an actual run. In the docs, `[U]` means unverified and `[V]` verified. Record evidence in `docs/dev/session-log.md`, and correct the docs when reality differs.
6. **Ask the owner** before `sudo`/system changes, spending money (AWS, Kiro credits), changing MVP scope or platform, choosing the licence or repo visibility, or anything needing an Inox change.
7. **No secrets in git.** That includes seed passwords (`.devstack/`), session IDs in logs and AWS credentials. Redact session IDs to their first 6 characters when logging them.
8. **Reviewer-facing material lives outside `/docs`:** `README.md`, `AWS_BUILDER.md`, `LICENSE`, `kiro-crew/`. Setup or run steps written only in `docs/` are invisible to reviewers.

## Layout (current; target in `docs/dev/architecture.md`)
- `packages/core/src`: platform-free TypeScript: `protocol.ts` (Inox wire types + guards), `api.ts`, `roomSocket.ts`, `sync.ts`, `room.ts` (room store: `roomReducer` + `createRoomSession`, incl. `changeMedia`, `sendChat`, `retryConnection`, and a `{type:'chat'}` event per new live message), `chat.ts` (Couch Reactions rules, D17: `REACTIONS`, `QUICK_REPLIES`, `isReaction`, Go-compatible trim and UTF-8 byte length), `lobby.ts` (`lobbyRows`, `mediaTitle`), `library.ts` (media library and Custom URL rules, D15/D16), `logger.ts`. It must not import `react-native`, `@amazon-devices/*`, hls.js or globals; `fetch`, `WebSocket`, timers, `now()` and the logger are injected so core runs unchanged under Node tests, the mock and a future Fire OS shell. Its `package.json` holds only test tooling (Vitest 4.1.11, D11; `.npmrc` sets `legacy-peer-deps`) and a strict tsconfig (`noUncheckedIndexedAccess`). The app imports core by relative path (`../../../../packages/core/src`) and Metro bundles it through `watchFolders` (D9); `metro.config.js` block-lists core's `node_modules/` and `test/`, so **core must keep zero runtime dependencies**. `RoomScreen.tsx` gets room state from `createRoomSession` and keeps only player alignment (`applyNow`, drift loop) itself.
- `apps/vega`: generated from the Vega RN 0.83 template (app id `com.fireosinox.tv`). `App.tsx` switches between Boot, SignIn, Lobby and Room (no navigation library). `platform/services.ts` wires core's `createApi` to the config and the session, which `platform/storage.ts` persists with Vega's AsyncStorage package (D19). `scripts/write-app-config.mjs` (`--backend stack|mock`, `--player-lab <url>`) writes two git-ignored files: `platform/config.generated.ts` (no secrets) and `platform/devCredentials.generated.ts` (seeded TV user), which `config.ts` `require`s only under `__DEV__` so release bundles never contain it; shapes in `config.example.ts`. UI kit in `components/ui/` (Toast, Pill, Skeleton, Dialog, `useTimedValue`); room overlays in `components/room/` (StatusBanner, ControlBar, ReactionTray, FloatingReactions, ChatBubbles, ChatPanel, ConnectionBanner, NoticeCard, DevHud). `src/components/LibraryPanel.tsx` is the room's media picker (D-pad down, controllers only) with Uploads and Custom URL tabs; `UrlKeyboard.tsx` is the app-drawn D-pad keyboard (URLs, and sign-in email/password via its optional props; no system keyboard in VVD). `src/dev/PlayerLab.tsx` is a dev-only player bench that replaces the app when `playerLab` is set. All UI values come from `theme/tokens.ts`, written in px @1080p and scaled by `UI_SCALE` 0.7 because Vega lays out on 960×540 (D18). The app icon is `assets/image/app_icon.png` (manifest `icon`).
- `apps/vega/src/player/VegaPlayer.ts` is our PlayerAdapter. It wraps Amazon's sample `hlsjsplayer/` (`HlsJsPlayer.ts`, polyfills, `dist/hls.mjs`), plus the root `PlayerBase.ts`/`PlayerInterface.ts`. HLS goes through hls.js; any other URL (MP4, MKV) uses the player's URL mode (`video.src`), chosen by core `isHlsUrl`. Keep fixes in `VegaPlayer.ts` rather than the vendored files. `dist/hls.mjs` is marked Amazon proprietary/confidential, so check its licence before the repo goes public.
- `tools/sync-probe/probe.mjs`: scripted room participant (`--as host|tv listen|send|script`, and `role member|moderator [--mute]` to set the TV user's role as host), reading `.devstack/seed-*.json`. `tools/validate/`: validation harness (browser host driver, sync analyser, network-kill, `dpad-walk.sh` remote-only walk of every screen, `enter-room.sh` log-driven relaunch into the room). `tools/devlog/devlog.mjs`: streams app JS logs from the Metro inspector. `tools/validate/static-cdn.mjs`: Range-capable file server (`--tls` for https) for Custom URL tests; `tools/validate/player-lab.sh <name> <url> -1 '{}' file` benches seeks on a single file; `tools/validate/vvd-type-url.mjs <text> [--play]`: types on the URL keyboard with remote keys, closed-loop on the focus log (~10 s per character).
- `tools/mock-inox/src/mock.mjs`: mock backend (`startMock()`; the CLI is `src/cli.mjs`, default port 18090) with failure injection (`--control` → `POST /__control/{scenario}`, `GET /__control/events`); also the reviewer-runnable backend. Every faked behaviour must cite the Inox source file it mirrors. The L2 suite starts it in-process on a random port.
- `devstack/`, `scripts/`: local Inox stack from a read-only snapshot (`scripts/lib.sh` holds shared paths and `load_env`); runtime state, logs and evidence go in `.devstack/` (git-ignored).

## Architecture essentials
These span several docs (`architecture.md`, `inox-contract.md`, `testing.md`) and are easy to get wrong:
- **Protocol types mirror Inox exactly** (snake_case, file header naming the Inox source file and commit). Inbound WS payloads go through runtime guards; malformed frames are dropped and logged, never thrown.
- **Room entry order:** `POST /rooms/{id}/join` → `GET /rooms/{id}` + `GET /messages` in parallel → WS connect → wait for `SYNC_PLAYBACK`. Skipping the join makes the WS handshake fail. Leaving the screen closes the socket but does not leave the room membership.
- **Sync uses an anchor model** ("position X at local time T", extrapolated), not a stored `currentTime`, plus a device−server clock offset taken from each `SYNC_PLAYBACK.timestamp`. PLAY latency compensation applies only when it is 0–5 s, matching the web client. Correction is seek-only through a seek-ahead-and-hold (core `correction()`, 0.5 s), gated on `video.buffered`. **On VVD (R17, D14): never start a paused player with a plain `play()` — always hold; never change `playbackRate`; a watchdog rebuilds the media element (`VegaPlayer.reset()`) when the playhead races or freezes.** See `docs/dev/architecture.md` §3.4.1 and friction F6.
- **Echo suppression:** drop own `PLAY`/`PAUSE`/`SEEK`/`CHANGE_MEDIA` (by `sender_id`), but render own `CHAT_MESSAGE` from the echo. Local actions apply optimistically.
- **Only explicit key handlers send playback events**; player callbacks never send. The server does not enforce `can_control_playback`, so the client must (show a toast instead).
- **Media keys belong to the room (D20):** w3cmedia's legacy PlayerSession would play/pause the element itself on media keys; `VegaPlayer` disables it before the first element. Don't remove that or add a Kepler Media Controls handler without routing it into `sendPlayback`.
- **Chat (Couch Reactions, D17):** reactions and quick replies are plain `CHAT_MESSAGE`s. The hub relays every chat frame and only skips *saving* invalid/muted ones, so the client enforces `can_send_messages`, 1–2000 UTF-8 bytes and a 1 s throttle, and drops relayed frames Inox wouldn't save. Inbound `SYNC_PLAYBACK` with a `sender_id` is forged and dropped.
- **Media switches rebuild the player** (`VegaPlayer.switchTo`, F8): loading a second stream into a used element never gets `loadedmetadata` on VVD.
- **Live media is out of scope:** show a notice and decline leadership by sending `LIVE_POSITION {unable:true}` when `LIVE_LEADER` names the TV user, or the live room stalls.
- **RoomSocket reconnects forever** while the room screen is mounted (1 s → 15 s backoff, ±20 % jitter, reset after 10 s open), checking `api.me()` first so a 401 routes to Sign-in.

## Status (2026-10-20)
**M1–M4 done and verified on VVD**, plus the differentiator **Couch Reactions** (D17). Persistent sign-in + D-pad keyboard, lobby, room overlays (banner with sync pill, control bar with the measured offset, reaction tray, floating reactions, chat bubbles/panel, reconnect + Retry), permission gating incl. media keys (D20), security audit fixes (release builds carry no dev credentials). Sync after the room rewrite: TV vs room p95 0.059 s (`sync-run-d17-a`). Reviewer `README.md` committed and its mock path verified on VVD. Branch `m1-core`. Next: M5 (owner: licence/visibility, Kiro Crew login, demo video) — see `docs/dev/session-log.md`.

Earlier: **M1 done**; **R17 mitigated** (D14; TV vs room p95 0.05–0.07 s). **Media library** (D15) and **Custom URL** (D16) added on owner request.

M0 spike done on VVD (Vega SDK 0.24.12112, CLI 1.4.4, RN 0.83 template, Zorin host works). Spike committed as `ba1d143`. Repo stays **private** for now (decision D12). Validation results:
- ✅ VVD boots, app runs · ✅ login + authenticated WS open 334 s with no reconnect · ✅ hls.js plays the Inox 1080/720/480 ladder and switches renditions · ✅ network loss → reconnect (backoff) → resync (0.03 s drift 6.4 s after restore) · ✅ chat panel, member-control toast.
- ⚠️ → ✅ Browser PLAY/PAUSE/SEEK reach the TV in ~50 ms. The M0 3–7 s excursions (F6/R17) were fixed on 2026-10-17 (see Status).
- ✅ Remote-only walk-through (`tools/validate/dpad-walk.sh`, evidence `dpad-walk.txt`); on-screen keyboard text entry untested (no keyboard appears in VVD).
- ⛔ Kiro Crew 0.8.0 installed; needs owner to install `kiro-cli` and run `kiro-cli login` before any task can run.
Evidence: `.devstack/evidence/` (screenshots, `sync-run-*.txt`, `netkill-2.txt`). Friction log F1–F8 in `docs/dev/friction-log.md`. Docs are updated with these findings (contract §6, local-stack, vega-simulator, architecture §3.4.1, roadmap M0, risks R16–R18, session-log).

## Verified gotchas (Vega / Inox)
- Vega `clearTimeout` throws on invalid handles → shimmed in `VegaPlayer.ts` (hls.js dies without it).
- RN WebSocket sends `Origin: http://localhost:18080` → allowlisted in `devstack/env.template`.
- Inox returns `null` (not `[]`) for empty lists → normalised in `packages/core/src/api.ts`.
- VVD clock is ~0.9 s behind host → sync uses the offset from `SYNC_PLAYBACK.timestamp`.
- `KEY_PLAYPAUSE` arrives as eventType `play`. JS logs only via `tools/devlog/devlog.mjs` (Metro inspector).
- 5.1 AAC doesn't decode on VVD; seed stereo content.
- VVD player (F6): `play()` on a paused player can race seconds ahead and then wedge; seeking does not unwedge it, only rebuilding the VideoPlayer does. Setting `playbackRate` on a stalled pipeline blocks JS for seconds. `playbackRate = 0` does not pause.
- Loading a new URL into a media element that already played one never becomes ready (F8) → `VegaPlayer.switchTo` rebuilds it.
- URL mode (single files) plays **https only**: `http://` and self-signed https fail at once with MediaError 4 and no request (F9). The UI refuses http file links; HLS over http is fine. `video.buffered` is always empty in URL mode → readiness comes from `readyState`.
- URL-mode **MKV ignores every seek** while `seekable` claims the whole file (F10). RoomScreen detects missed seeks (2 → URL unseekable: no seeks, no R17 rebuilds, play/pause only, notice). MP4 seeks fine.
- VVD's system log is flooded by a crashing `stem-init` webview prewarm loop; it rarely helps for media errors.
- If the app dies at launch with "React Refresh runtime should not be included in the production bundle" + "Cannot read property 'default' of undefined", restart Metro with `--reset-cache` (seen 2026-10-17 after starting Metro while `npm run build:debug` ran).
- Stop the app before rewriting `config.generated.ts`, or Metro hot-reloads it and a following launch restarts it mid-run.
- The centre key arrives as eventType `enter`, not `select` (F11). `KEY_PLAYPAUSE` arrives as `play` (F5). Pressables fire `onPress` on key-up, ~250 ms after the key-down `useTVEventHandler` sees: RoomScreen guards overlay buttons for 350 ms after an overlay opens.
- Vega lays out on 960×540 logical at pixelRatio 2 (F14, D18). The legacy `AsyncStorage` in react-native-kepler doesn't persist across app restarts (F12, D19). w3cmedia's legacy PlayerSession drives the player on media keys unless disabled (F13, D20).
- A native dependency, `manifest.toml` or `assets/` change needs `npm run build:debug` + `vega run-app` (reinstalling clears app data, so the session too). Stop the app and Metro before building, then restart Metro with `--reset-cache`.
- Metro works bound to loopback (`--host 127.0.0.1`) through the VVD reverse forward; prefer it (the dev bundle carries the dev credentials).
- The 150 s BBB clip ends quickly: Inox keeps "playing" past the end, the TV parks on the last frame and shows "Ended". Reset with `probe.mjs send PAUSE '{"media_time_seconds":0}'` before a demo or sync run.
- `pkill -f`/`pgrep -f` with a pattern that appears in your own command line kills your shell — anchor patterns (`^…`).

## Commands
Confirmed working on 2026-10-16:
- Stack: `scripts/inox-snapshot.sh && scripts/inox-build.sh && scripts/render-env.sh && scripts/stack-up.sh`, then `scripts/run-backend.sh` / `scripts/run-worker.sh` (background with `setsid nohup … &`), `node scripts/seed.mjs`.
- VVD: `source ~/vega/env; vega virtual-device start --timeout 240`; wait for `vda devices` to show `device`; `scripts/vvd-forward.sh` (and `vega device start-port-forwarding --port 8081 --forward false` for Metro).
- App: `node scripts/write-app-config.mjs`; `cd apps/vega && npm run build:debug && vega run-app build/x86_64-debug/fireosinox_x86_64.vpkg`; dev loop: `npx react-native start --port 8081 --host 127.0.0.1` + `node tools/devlog/devlog.mjs > .devstack/logs/app-all.log`.
- Device walks (2026-10-20): `tools/validate/enter-room.sh` (relaunch into the room, signing in only if asked), `tools/validate/dpad-walk.sh > .devstack/evidence/dpad-walk-<x>.txt`, `tools/validate/sync-r17.sh <name>` (reset the room to 0 first). Roles: `node tools/sync-probe/probe.mjs role moderator|member [--mute]`, then re-enter the room.
- Typecheck: `cd apps/vega && npx tsc --noEmit -p tsconfig.json` (also covers the core files the app imports).
- Lint: `cd apps/vega && npm run lint` (0 errors; the system-distributed-library and `no-void` warnings are expected).
- Relaunch without rebuilding (JS comes from Metro): `vega device terminate-app --appName com.fireosinox.tv.main; vega device launch-app --appName com.fireosinox.tv.main`.
- App against the mock: see `docs/dev/vega-simulator.md` §4 (mock on 18090 + `vega device start-port-forwarding --port 18090 --forward false` + `write-app-config.mjs --backend mock`).
- R17 tools: `tools/validate/player-lab.sh <name> <url> [level] [hls-json] [suite]` (player bench) and `tools/validate/sync-r17.sh <name>` (long-pause sync run vs the web client; read "TV vs room").
- Drive/inspect VVD: `scripts/vvd.sh key KEY_DOWN …`, `scripts/vvd.sh shot <name>`.
- Validation: web client from snapshot on :15173 (see local-stack.md §8), `node tools/validate/browser-host.mjs tools/validate/sync-script.json`, `node tools/validate/analyze-sync.mjs <web.log> .devstack/logs/app-all.log`, `tools/validate/netkill.sh`, `node tools/sync-probe/probe.mjs send|listen|script`.
- Core (verified 2026-10-16, run in `packages/core`): `npm run typecheck`, `npm test` (L1 unit), `npm run test:l2` (L2: core against the mock over localhost), `npm run test:all`. Single test: `npx vitest run test/sync.test.ts -t "PLAY adds"`.
- Custom URL test media: `scripts/make-progressive-fixture.sh` (MP4 + MKV in `.devstack/cdn/`), `node tools/validate/static-cdn.mjs` (:18100). The TV can't play these over http/self-signed https (F9), so test TV file playback with public https URLs (e.g. Inox's default `https://media.w3.org/2010/05/bunny/movie.mp4`). Room switches without typing: `node tools/sync-probe/probe.mjs --as host send CHANGE_MEDIA '{"media_url":"…","media_time_seconds":0,"is_playing":false}'`.
- Mock: `cd tools/mock-inox && npm install && node src/cli.mjs --control` (password: `MOCK_PASSWORD` or `mock-only-password`). HLS fixture: `scripts/make-hls-fixture.sh` (ffmpeg; synthetic, git-ignored).
- After changing `metro.config.js`, restart Metro: it was started detached, with output to `.devstack/logs/metro.log`.

## Working agreement
- Milestones run in order (`docs/dev/roadmap.md`). M0 is a go/no-go gate.
- Definition of done is in `docs/dev/conventions.md`: typecheck/lint/tests green, behaviour verified on the right layer (unit / mock / VVD per `docs/dev/testing.md`), docs updated, evidence logged.
- Decisions are appended to `docs/planning/decisions.md`; never rewrite an accepted one, supersede it.
- Commits: imperative with a scope (`core: add RoomSocket backoff`); each new dependency needs a one-line reason in the commit message.
- End every session by appending to `docs/dev/session-log.md` (newest at top) with the exact next step.
