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

## Layout (target; see `docs/dev/architecture.md`)
- `packages/core`: platform-free TypeScript (protocol types, API client, RoomSocket, sync, room store). Must not import `react-native`, `@amazon-devices/*`, hls.js or globals; `fetch`, `WebSocket`, timers, `now()` and the logger are injected so core runs unchanged under Vitest, the mock and a future Fire OS shell.
- `apps/vega`: the React Native for Vega app (screens, focus/keys, PlayerAdapter, theme tokens). All UI values come from `apps/vega/src/theme/tokens.ts`.
- `tools/mock-inox`: mock backend with failure injection (`--control` → `POST /__control/{scenario}`); also the reviewer-runnable backend. Every faked behaviour must cite the Inox source file it mirrors.
- `tools/sync-probe`: scripted room participant and sync measurement.
- `devstack/`, `scripts/`: local Inox stack from a read-only snapshot; runtime state goes in `.devstack/` (git-ignored).

## Architecture essentials
These span several docs (`architecture.md`, `inox-contract.md`, `testing.md`) and are easy to get wrong:
- **Protocol types mirror Inox exactly** (snake_case, file header naming the Inox source file and commit). Inbound WS payloads go through runtime guards; malformed frames are dropped and logged, never thrown.
- **Room entry order:** `POST /rooms/{id}/join` → `GET /rooms/{id}` + `GET /messages` in parallel → WS connect → wait for `SYNC_PLAYBACK`. Skipping the join makes the WS handshake fail. Leaving the screen closes the socket but does not leave the room membership.
- **Sync uses an anchor model** ("position X at local time T", extrapolated), not a stored `currentTime`, plus a device−server clock offset taken from each `SYNC_PLAYBACK.timestamp`. PLAY latency compensation applies only when it is 0–5 s, matching the web client. Corrections: rate ladder (±0.05/±0.15) up to 1.5 s, beyond that seek-ahead-and-hold gated on `video.buffered`; never seek while paused unless more than 1.5 s off (see `docs/dev/architecture.md` §3.4.1 — this supersedes the original seek-only policy).
- **Echo suppression:** drop own `PLAY`/`PAUSE`/`SEEK`/`CHANGE_MEDIA` (by `sender_id`), but render own `CHAT_MESSAGE` from the echo. Local actions apply optimistically.
- **Only explicit key handlers send playback events**; player callbacks never send. The server does not enforce `can_control_playback`, so the client must (show a toast instead).
- **Live media is out of scope:** show a notice and decline leadership by sending `LIVE_POSITION {unable:true}` when `LIVE_LEADER` names the TV user, or the live room stalls.
- **RoomSocket reconnects forever** while the room screen is mounted (1 s → 15 s backoff, ±20 % jitter, reset after 10 s open), checking `api.me()` first so a 401 routes to Sign-in.

## Status (2026-10-16, end of validation session)
M0 spike done on VVD (Vega SDK 0.24.12112, CLI 1.4.4, RN 0.83 template, Zorin host works). Spike committed as `ba1d143`. Repo stays **private** for now (decision D12). Validation results:
- ✅ VVD boots, app runs · ✅ login + authenticated WS open 334 s with no reconnect · ✅ hls.js plays the Inox 1080/720/480 ladder and switches renditions · ✅ network loss → reconnect (backoff) → resync (0.03 s drift 6.4 s after restore) · ✅ chat panel, member-control toast.
- ⚠️ Browser PLAY/PAUSE/SEEK reach the TV in ~50 ms; TV median drift vs room ~0.04 s, but VVD's player sometimes jumps ~5 s ahead on play/after seeks (friction F6) → 3–7 s excursions before correction. Partial.
- ✅ Remote-only walk-through (`tools/validate/dpad-walk.sh`, evidence `dpad-walk.txt`); on-screen keyboard text entry untested (no keyboard appears in VVD).
- ⛔ Kiro Crew 0.8.0 installed; needs owner to install `kiro-cli` and run `kiro-cli login` before any task can run.
Evidence: `.devstack/evidence/` (screenshots, `sync-run-*.txt`, `netkill-2.txt`). Friction log F1–F7 in `docs/dev/friction-log.md`. Docs are updated with these findings (contract §6, local-stack, vega-simulator, architecture §3.4.1, roadmap M0, risks R16–R18, session-log).

## Verified gotchas (Vega / Inox)
- Vega `clearTimeout` throws on invalid handles → shimmed in `VegaPlayer.ts` (hls.js dies without it).
- RN WebSocket sends `Origin: http://localhost:18080` → allowlisted in `devstack/env.template`.
- Inox returns `null` (not `[]`) for empty lists → normalised in `packages/core/src/api.ts`.
- VVD clock is ~0.9 s behind host → sync uses the offset from `SYNC_PLAYBACK.timestamp`.
- `KEY_PLAYPAUSE` arrives as eventType `play`. JS logs only via `tools/devlog/devlog.mjs` (Metro inspector).
- 5.1 AAC doesn't decode on VVD; seed stereo content. Don't seek while paused (resume jumps).
- `pkill -f`/`pgrep -f` with a pattern that appears in your own command line kills your shell — anchor patterns (`^…`).

## Commands
Confirmed working on 2026-10-16:
- Stack: `scripts/inox-snapshot.sh && scripts/inox-build.sh && scripts/render-env.sh && scripts/stack-up.sh`, then `scripts/run-backend.sh` / `scripts/run-worker.sh` (background with `setsid nohup … &`), `node scripts/seed.mjs`.
- VVD: `source ~/vega/env; vega virtual-device start --timeout 240`; wait for `vda devices` to show `device`; `scripts/vvd-forward.sh` (and `vega device start-port-forwarding --port 8081 --forward false` for Metro).
- App: `node scripts/write-app-config.mjs`; `cd apps/vega && npm run build:debug && vega run-app build/x86_64-debug/fireosinox_x86_64.vpkg`; dev loop: `npx react-native start --port 8081` + `node tools/devlog/devlog.mjs > .devstack/logs/app-all.log`.
- Typecheck: `cd apps/vega && npx tsc --noEmit -p tsconfig.json`.
- Drive/inspect VVD: `scripts/vvd.sh key KEY_DOWN …`, `scripts/vvd.sh shot <name>`.
- Validation: web client from snapshot on :15173 (see local-stack.md §8), `node tools/validate/browser-host.mjs tools/validate/sync-script.json`, `node tools/validate/analyze-sync.mjs <web.log> .devstack/logs/app-all.log`, `tools/validate/netkill.sh`, `node tools/sync-probe/probe.mjs send|listen|script`.
- Core tests: none yet (M1; Vitest proposed, D11). Layout decided: standalone npm app + Metro `watchFolders` (D9).

## Working agreement
- Milestones run in order (`docs/dev/roadmap.md`). M0 is a go/no-go gate.
- Definition of done is in `docs/dev/conventions.md`: typecheck/lint/tests green, behaviour verified on the right layer (unit / mock / VVD per `docs/dev/testing.md`), docs updated, evidence logged.
- Decisions are appended to `docs/planning/decisions.md`; never rewrite an accepted one, supersede it.
- Commits: imperative with a scope (`core: add RoomSocket backoff`); each new dependency needs a one-line reason in the commit message.
- End every session by appending to `docs/dev/session-log.md` (newest at top) with the exact next step.
