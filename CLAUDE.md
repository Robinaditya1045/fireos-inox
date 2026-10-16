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
- `packages/core/src`: platform-free TypeScript: `protocol.ts` (Inox wire types + guards), `api.ts`, `roomSocket.ts`, `sync.ts`, `room.ts` (room store: `roomReducer` + `createRoomSession`), `logger.ts`. It must not import `react-native`, `@amazon-devices/*`, hls.js or globals; `fetch`, `WebSocket`, timers, `now()` and the logger are injected so core runs unchanged under Node tests, the mock and a future Fire OS shell. Its `package.json` holds only test tooling (Vitest 4.1.11, D11; `.npmrc` sets `legacy-peer-deps`) and a strict tsconfig (`noUncheckedIndexedAccess`). The app imports core by relative path (`../../../../packages/core/src`) and Metro bundles it through `watchFolders` (D9); `metro.config.js` block-lists core's `node_modules/` and `test/`, so **core must keep zero runtime dependencies**. `RoomScreen.tsx` gets room state from `createRoomSession` and keeps only player alignment (`applyNow`, drift loop) itself.
- `apps/vega`: generated from the Vega RN 0.83 template (app id `com.fireosinox.tv`). `App.tsx` switches between the SignIn, Lobby and Room screens (no navigation library yet). `platform/services.ts` wires core's `createApi` to the app's config and an in-memory session (AsyncStorage persistence is M2). `platform/config.generated.ts` is git-ignored and written by `scripts/write-app-config.mjs` (`--backend stack|mock`, `--player-lab <url>`; shape in `config.example.ts`). `src/dev/PlayerLab.tsx` is a dev-only player bench that replaces the app when `playerLab` is set. All UI values come from `theme/tokens.ts`.
- `apps/vega/src/player/VegaPlayer.ts` is our PlayerAdapter. It wraps Amazon's sample `hlsjsplayer/` (`HlsJsPlayer.ts`, polyfills, `dist/hls.mjs`), plus the root `PlayerBase.ts`/`PlayerInterface.ts`. Keep fixes in `VegaPlayer.ts` rather than the vendored files. `dist/hls.mjs` is marked Amazon proprietary/confidential, so check its licence before the repo goes public.
- `tools/sync-probe/probe.mjs`: scripted room participant (`--as host|tv listen|send|script`), reading `.devstack/seed-*.json`. `tools/validate/`: M0 validation harness (browser host driver, sync analyser, network-kill, D-pad walk). `tools/devlog/devlog.mjs`: streams app JS logs from the Metro inspector.
- `tools/mock-inox/src/mock.mjs`: mock backend (`startMock()`; the CLI is `src/cli.mjs`, default port 18090) with failure injection (`--control` → `POST /__control/{scenario}`, `GET /__control/events`); also the reviewer-runnable backend. Every faked behaviour must cite the Inox source file it mirrors. The L2 suite starts it in-process on a random port.
- `devstack/`, `scripts/`: local Inox stack from a read-only snapshot (`scripts/lib.sh` holds shared paths and `load_env`); runtime state, logs and evidence go in `.devstack/` (git-ignored).

## Architecture essentials
These span several docs (`architecture.md`, `inox-contract.md`, `testing.md`) and are easy to get wrong:
- **Protocol types mirror Inox exactly** (snake_case, file header naming the Inox source file and commit). Inbound WS payloads go through runtime guards; malformed frames are dropped and logged, never thrown.
- **Room entry order:** `POST /rooms/{id}/join` → `GET /rooms/{id}` + `GET /messages` in parallel → WS connect → wait for `SYNC_PLAYBACK`. Skipping the join makes the WS handshake fail. Leaving the screen closes the socket but does not leave the room membership.
- **Sync uses an anchor model** ("position X at local time T", extrapolated), not a stored `currentTime`, plus a device−server clock offset taken from each `SYNC_PLAYBACK.timestamp`. PLAY latency compensation applies only when it is 0–5 s, matching the web client. Correction is seek-only through a seek-ahead-and-hold (core `correction()`, 0.5 s), gated on `video.buffered`. **On VVD (R17, D14): never start a paused player with a plain `play()` — always hold; never change `playbackRate`; a watchdog rebuilds the media element (`VegaPlayer.reset()`) when the playhead races or freezes.** See `docs/dev/architecture.md` §3.4.1 and friction F6.
- **Echo suppression:** drop own `PLAY`/`PAUSE`/`SEEK`/`CHANGE_MEDIA` (by `sender_id`), but render own `CHAT_MESSAGE` from the echo. Local actions apply optimistically.
- **Only explicit key handlers send playback events**; player callbacks never send. The server does not enforce `can_control_playback`, so the client must (show a toast instead).
- **Live media is out of scope:** show a notice and decline leadership by sending `LIVE_POSITION {unable:true}` when `LIVE_LEADER` names the TV user, or the live room stalls.
- **RoomSocket reconnects forever** while the room screen is mounted (1 s → 15 s backoff, ±20 % jitter, reset after 10 s open), checking `api.me()` first so a 401 routes to Sign-in.

## Status (2026-10-17)
**M1 done**; **R17 mitigated** (D14; sync runs after the fix: TV vs room p95 0.05–0.07 s). `RoomScreen` now uses `createRoomSession`; the app has a mock mode. Branch `m1-core`. Next: M2 (session persistence, lobby) — see `docs/dev/session-log.md`.

M0 spike done on VVD (Vega SDK 0.24.12112, CLI 1.4.4, RN 0.83 template, Zorin host works). Spike committed as `ba1d143`. Repo stays **private** for now (decision D12). Validation results:
- ✅ VVD boots, app runs · ✅ login + authenticated WS open 334 s with no reconnect · ✅ hls.js plays the Inox 1080/720/480 ladder and switches renditions · ✅ network loss → reconnect (backoff) → resync (0.03 s drift 6.4 s after restore) · ✅ chat panel, member-control toast.
- ⚠️ → ✅ Browser PLAY/PAUSE/SEEK reach the TV in ~50 ms. The M0 3–7 s excursions (F6/R17) were fixed on 2026-10-17 (see Status).
- ✅ Remote-only walk-through (`tools/validate/dpad-walk.sh`, evidence `dpad-walk.txt`); on-screen keyboard text entry untested (no keyboard appears in VVD).
- ⛔ Kiro Crew 0.8.0 installed; needs owner to install `kiro-cli` and run `kiro-cli login` before any task can run.
Evidence: `.devstack/evidence/` (screenshots, `sync-run-*.txt`, `netkill-2.txt`). Friction log F1–F7 in `docs/dev/friction-log.md`. Docs are updated with these findings (contract §6, local-stack, vega-simulator, architecture §3.4.1, roadmap M0, risks R16–R18, session-log).

## Verified gotchas (Vega / Inox)
- Vega `clearTimeout` throws on invalid handles → shimmed in `VegaPlayer.ts` (hls.js dies without it).
- RN WebSocket sends `Origin: http://localhost:18080` → allowlisted in `devstack/env.template`.
- Inox returns `null` (not `[]`) for empty lists → normalised in `packages/core/src/api.ts`.
- VVD clock is ~0.9 s behind host → sync uses the offset from `SYNC_PLAYBACK.timestamp`.
- `KEY_PLAYPAUSE` arrives as eventType `play`. JS logs only via `tools/devlog/devlog.mjs` (Metro inspector).
- 5.1 AAC doesn't decode on VVD; seed stereo content.
- VVD player (F6): `play()` on a paused player can race seconds ahead and then wedge; seeking does not unwedge it, only rebuilding the VideoPlayer does. Setting `playbackRate` on a stalled pipeline blocks JS for seconds. `playbackRate = 0` does not pause.
- Stop the app before rewriting `config.generated.ts`, or Metro hot-reloads it and a following launch restarts it mid-run.
- `pkill -f`/`pgrep -f` with a pattern that appears in your own command line kills your shell — anchor patterns (`^…`).

## Commands
Confirmed working on 2026-10-16:
- Stack: `scripts/inox-snapshot.sh && scripts/inox-build.sh && scripts/render-env.sh && scripts/stack-up.sh`, then `scripts/run-backend.sh` / `scripts/run-worker.sh` (background with `setsid nohup … &`), `node scripts/seed.mjs`.
- VVD: `source ~/vega/env; vega virtual-device start --timeout 240`; wait for `vda devices` to show `device`; `scripts/vvd-forward.sh` (and `vega device start-port-forwarding --port 8081 --forward false` for Metro).
- App: `node scripts/write-app-config.mjs`; `cd apps/vega && npm run build:debug && vega run-app build/x86_64-debug/fireosinox_x86_64.vpkg`; dev loop: `npx react-native start --port 8081` + `node tools/devlog/devlog.mjs > .devstack/logs/app-all.log`.
- Typecheck: `cd apps/vega && npx tsc --noEmit -p tsconfig.json` (also covers the core files the app imports).
- Lint: `cd apps/vega && npm run lint` (0 errors; the system-distributed-library and `no-void` warnings are expected).
- Relaunch without rebuilding (JS comes from Metro): `vega device terminate-app --appName com.fireosinox.tv.main; vega device launch-app --appName com.fireosinox.tv.main`.
- App against the mock: see `docs/dev/vega-simulator.md` §4 (mock on 18090 + `vega device start-port-forwarding --port 18090 --forward false` + `write-app-config.mjs --backend mock`).
- R17 tools: `tools/validate/player-lab.sh <name> <url> [level] [hls-json] [suite]` (player bench) and `tools/validate/sync-r17.sh <name>` (long-pause sync run vs the web client; read "TV vs room").
- Drive/inspect VVD: `scripts/vvd.sh key KEY_DOWN …`, `scripts/vvd.sh shot <name>`.
- Validation: web client from snapshot on :15173 (see local-stack.md §8), `node tools/validate/browser-host.mjs tools/validate/sync-script.json`, `node tools/validate/analyze-sync.mjs <web.log> .devstack/logs/app-all.log`, `tools/validate/netkill.sh`, `node tools/sync-probe/probe.mjs send|listen|script`.
- Core (verified 2026-10-16, run in `packages/core`): `npm run typecheck`, `npm test` (L1 unit), `npm run test:l2` (L2: core against the mock over localhost), `npm run test:all`. Single test: `npx vitest run test/sync.test.ts -t "PLAY adds"`.
- Mock: `cd tools/mock-inox && npm install && node src/cli.mjs --control` (password: `MOCK_PASSWORD` or `mock-only-password`). HLS fixture: `scripts/make-hls-fixture.sh` (ffmpeg; synthetic, git-ignored).
- After changing `metro.config.js`, restart Metro: it was started detached, with output to `.devstack/logs/metro.log`.

## Working agreement
- Milestones run in order (`docs/dev/roadmap.md`). M0 is a go/no-go gate.
- Definition of done is in `docs/dev/conventions.md`: typecheck/lint/tests green, behaviour verified on the right layer (unit / mock / VVD per `docs/dev/testing.md`), docs updated, evidence logged.
- Decisions are appended to `docs/planning/decisions.md`; never rewrite an accepted one, supersede it.
- Commits: imperative with a scope (`core: add RoomSocket backoff`); each new dependency needs a one-line reason in the commit message.
- End every session by appending to `docs/dev/session-log.md` (newest at top) with the exact next step.
