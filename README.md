# FireOS-Inox: the watch party, on the big screen

FireOS-Inox is a **Fire TV app for Vega OS** (React Native for Vega) that brings [Inox](#inox-and-whats-new), a synchronised watch-party platform, to the living-room TV. Friends on laptops and the family on the couch watch the same video **in sync to within a few hundredths of a second**, and react together using nothing but the TV remote.

> Built for the *Build, Ship, Shape: Amazon Developer Hackathon* (Fire TV track + AWS Builder mini-challenge). Everything in this repository was written during the submission period; Inox itself predates it (see [Inox and what's new](#inox-and-whats-new)).

## What it does

| | Feature | How it works |
|---|---|---|
| 🔑 | **Sign in once** | The session is stored on the device and re-checked at boot (`GET /users/me`). An expired session goes back to sign-in with a clear message. Credentials can be typed with the remote on an app-drawn keyboard, because the Vega Virtual Device shows no system keyboard. |
| 🛋️ | **Lobby built for the couch** | "Now Streaming" (occupied rooms: what's playing, ▶/❚❚, how many are watching) and "All rooms". It refreshes every 15 s without moving focus, remembers the last room you entered, and asks before leaving the app. |
| 🎬 | **Frame-tight sync** | The TV follows the room's play, pause, seek and media changes. Sync uses an anchor model ("position X at local time T") plus a device-to-server clock offset. Measured on the Vega Virtual Device against the Inox web client: **TV vs room p50 0.046 s, p95 0.059 s** while playing. |
| 😂 | **Couch Reactions** *(the differentiator)* | Press **▲** and send 😂 😮 🔥 👏 ❤️ 😢 or a quick reply ("Pause please!") to the whole room. Reactions from anyone, TV or web, float up over the video with the sender's name; other chat pops up as bubbles. They travel as ordinary Inox chat, so the web app shows them and Inox saves them, with **no backend change**. |
| ✅ | **Sync you can see** | The status banner says **● In sync** or **↻ Catching up…**, and the control bar shows the measured offset ("In sync ±0.05 s"). A paused or finished room says so, and says who can start it. |
| 🎮 | **Remote-only controls, permission-aware** | Play/pause and ±10 s for the whole room, a control bar with progress, chat panel, media library and custom MP4/MKV/HLS links. Members without playback control get a toast and **nothing is sent**; the platform's own media-key handling is switched off so it can't act behind the room's back. |
| 📶 | **Resilient** | Reconnects forever with backoff while you're in a room, then resyncs from the server's state. After 30 s it says "Can't reach Inox" and offers **Retry** (reconnect now). Live channels are declined politely, so a live room keeps working. |

## Demo walkthrough (about 2 minutes)

Run the [local Inox stack](#quick-start-b-local-inox-stack) (or the [mock](#quick-start-a-mock-backend-no-inox-needed)) and the app on the Vega Virtual Device (VVD). Open the Inox web client on `http://localhost:15173` as the host, side by side with the VVD.

1. **Boot.** The app restores the session (or signs in: dev builds prefill the TV user `couch`) and opens the lobby. "Movie Night" is under *Now Streaming*.
2. **Join.** Select the room. The banner shows the room, the title and **● In sync**; the video is at the host's position.
3. **Follow the host.** Play, pause and seek in the web app; the TV follows within a fraction of a second. Press **OK** on the TV to show the control bar with "In sync ±0.0x s".
4. **React.** Press **▲**, pick 😂: it floats over the TV picture and appears in the web chat. Type 🔥 in the web chat: it floats on the TV.
5. **Quick reply.** **▲** → "Pause please!": the host reads it in chat.
6. **Permissions.** As a member, press ⏯: "Only the host can control playback", and nothing reaches the room. Promote the TV user (web UI, or `node tools/sync-probe/probe.mjs role moderator`), re-enter the room, and ⏯ now pauses everyone.
7. **Resilience.** Stop the backend: "Reconnecting…", then "Can't reach Inox · Retry". Start it again and press **OK**: the TV reconnects and resyncs.

## Architecture

```
 Vega Virtual Device                                   Host
┌───────────────────────────────────┐   REST /api/v1   ┌─────────────────────────────────┐
│ apps/vega   React Native for Vega │ ───────────────▶ │ Inox server (local, isolated)   │
│  Boot · SignIn · Lobby · Room     │   WS /rooms/ws   │   or tools/mock-inox (reviewers)│
│  VegaPlayer: W3C media + hls.js   │ ◀──────────────▶ │                                 │
├───────────────────────────────────┤   HLS / MP4      │ Inox web client = 2nd viewer    │
│ packages/core  pure TypeScript    │ ───────────────▶ │ tools/sync-probe = scripted one │
│  protocol · api · RoomSocket ·    │                  └─────────────────────────────────┘
│  sync · room store · chat · lobby │
└───────────────────────────────────┘
```

- **`packages/core`** is platform-free TypeScript with zero runtime dependencies: Inox wire types and runtime guards, the REST client, a reconnecting `RoomSocket`, the sync maths, the room store (`roomReducer` + `createRoomSession`: join → details + history → socket, echo suppression, permission-gated sends, live-leadership decline, chat and reactions with Inox's own validation rules) and the lobby model. `fetch`, `WebSocket`, timers and the clock are injected, so the same code runs in Node tests and on the TV. 129 Vitest tests: unit (L1) and contract tests against the mock (L2).
- **`apps/vega`** is the Vega app (RN 0.83 template, app id `com.fireosinox.tv`): screens, a 10-foot UI kit (design tokens, focus-safe buttons, toast, pill, dialog, skeletons), room overlays, remote key handling, and `VegaPlayer`, our adapter over the W3C media player and Amazon's hls.js build.
- **`tools/mock-inox`** is a contract-faithful mock of the Inox REST + WebSocket subset the TV uses, with failure injection (drop sockets, expire sessions, latency, malformed frames, live leadership, permissions). Every faked behaviour cites the Inox source file it mirrors.
- **`tools/sync-probe`**, **`tools/validate`** and **`tools/devlog`** are the scripted participant, the validation harness (sync analyser, remote-only walk, network kill, player bench) and the device log streamer.

### Engineering notes

- **The VVD's media pipeline can race seconds ahead and then freeze** when a paused player is resumed with a plain `play()`. We reproduced it in isolation and designed around it: a paused player is only ever started through a **seek-ahead-and-hold** (seek past the room position by the learned seek latency, wait for buffered data, start exactly when the room reaches that frame); correction is seek-only (changing `playbackRate` blocked the JS thread for seconds); and a watchdog rebuilds the media element when the playhead races or freezes. That took the TV-vs-room p95 from about 1.0 s (max 5.95 s) to under 0.07 s.
- **Media keys belong to the room, not the player.** Vega's W3C media player, in its default mode, plays and pauses the element itself on the remote's media keys. In a watch party that would let a member pause their own TV and issue exactly the resume that triggers the race above, so the app disables it and routes every key through the room's permission check.
- **Chat rules are enforced on the TV.** Inox's hub relays every chat frame and only skips *saving* the ones from members without `can_send_messages` (or over 2000 bytes), so the TV checks permission, length and a 1-message-per-second throttle itself, and drops relayed messages Inox wouldn't save. A forged `SYNC_PLAYBACK` from another member (real ones carry no sender) is dropped too.

## Prerequisites

- Linux x86_64 with KVM (the Vega Virtual Device needs it). Developed on Zorin OS 17.3 (Ubuntu 22.04 base).
- Node.js 22 and npm.
- **Vega SDK 0.24** with Vega CLI 1.4.4 ([Amazon's install guide](https://developer.amazon.com/docs/vega/latest/install-vega-sdk.html)); `source ~/vega/env` puts `vega` on the PATH.
- ffmpeg (generates the synthetic test video for the mock).
- For the real backend only: Docker, Go 1.25 and read access to the Inox repository.

## Quick start A: mock backend (no Inox needed)

```bash
# 1. Dependencies
(cd packages/core && npm install)
(cd tools/mock-inox && npm install)
(cd apps/vega && npm install)

# 2. Synthetic HLS test video for the mock (60 s test pattern + tone; no licence involved)
scripts/make-hls-fixture.sh

# 3. Mock backend on :18090 (users admin@fireos-inox.test = owner/host, tv@fireos-inox.test = member;
#    password: $MOCK_PASSWORD or "mock-only-password")
node tools/mock-inox/src/cli.mjs --port 18090 --public-url http://localhost:18090 --control

# 4. Virtual device (second terminal)
source ~/vega/env
vega virtual-device start --timeout 240
vega device start-port-forwarding --port 18090 --forward false   # the TV reaches the mock as localhost
vega device start-port-forwarding --port 8081 --forward false    # Metro

# 5. App config (git-ignored) pointing at the mock, then Metro + debug build
node scripts/write-app-config.mjs --backend mock
cd apps/vega
npx react-native start --port 8081 --host 127.0.0.1          # keep running (third terminal)
npm run build:debug && vega run-app build/x86_64-debug/fireosinox_x86_64.vpkg
```

The dev build prefills the TV user: press **OK** to sign in, **OK** again to enter "Movie Night". Then act as the host through the mock's control API:

```bash
curl -X POST 'http://localhost:18090/__control/send?type=PLAY&t=0'     # host presses play
curl -X POST 'http://localhost:18090/__control/send?type=PAUSE&t=20'   # host pauses at 20 s
curl -X POST --get 'http://localhost:18090/__control/send' \
     --data-urlencode 'type=CHAT_MESSAGE' --data-urlencode 'payload={"message":"🔥"}'   # host reacts
curl -X POST 'http://localhost:18090/__control/drop-sockets'            # simulate a network drop
curl 'http://localhost:18090/__control/events'                          # what the TV sent (e.g. its reactions)
```

## Quick start B: local Inox stack

This runs a real Inox backend, transcoding worker and web client **locally and in isolation** (own Docker project `fireos-inox-dev`, non-default ports 15432/16379/18080/15173), built from a read-only snapshot of the Inox repository.

```bash
scripts/inox-snapshot.sh && scripts/inox-build.sh && scripts/render-env.sh && scripts/stack-up.sh
mkdir -p .devstack/logs
setsid nohup scripts/run-backend.sh > .devstack/logs/backend.log 2>&1 &
setsid nohup scripts/run-worker.sh  > .devstack/logs/worker.log  2>&1 &
node scripts/seed.mjs          # users host + couch, a Big Buck Bunny clip as an HLS ladder, room "Movie Night"
scripts/vvd-forward.sh         # after the VVD has booted (step 4 above)
node scripts/write-app-config.mjs
```

Then start Metro and run the app as in step 5 above. The second participant is either the Inox web client served from the snapshot on `http://localhost:15173` (sign in as `host`), or the scripted probe:

```bash
node tools/sync-probe/probe.mjs send PLAY '{"media_time_seconds":0}'      # as host
node tools/sync-probe/probe.mjs send CHAT_MESSAGE '{"message":"😂"}'       # a reaction from the host
node tools/sync-probe/probe.mjs listen                                    # everything the room sees
node tools/sync-probe/probe.mjs role moderator                            # let the TV control playback
node tools/sync-probe/probe.mjs role member --mute                        # member without chat
```

Room roles are read when the TV enters a room, so re-enter it after a role change. Seeded passwords are generated on first run into `.devstack/seed-credentials.json` (git-ignored). Postgres and Redis listen on 127.0.0.1 only; the Inox server itself listens on all interfaces (Inox has no bind-address setting), so on an untrusted network block port 18080 with your firewall.

## Remote control

| Key | Lobby / sign-in | In a room |
|---|---|---|
| **▲ Up** | Move focus | Reaction tray: emoji and quick replies |
| **OK** | Select | Control bar: play/pause, ±10 s, react, chat, library, progress and sync offset |
| **▼ Down** | Move focus | Media library (Uploads, Custom URL); hosts and moderators only |
| **☰ Menu** | — | Chat panel |
| **⏯ ⏪ ⏩** | — | Play/pause and ±10 s for the whole room (with playback control) |
| **Back** | "Leave Inox?" prompt | Close the open panel, otherwise back to the lobby |

## Tests and checks

```bash
cd packages/core && npm run typecheck && npm run test:all     # 129 tests: L1 unit + L2 contract tests against the mock
cd apps/vega && npx tsc --noEmit -p tsconfig.json && npm run lint
```

Device-level checks (VVD + local stack, need Metro and `node tools/devlog/devlog.mjs > .devstack/logs/app-all.log`):

- `tools/validate/sync-r17.sh <name>`: drives the Inox web client through pauses and seeks and reports TV-vs-room sync.
- `tools/validate/dpad-walk.sh`: remote-only walk through every screen and room overlay, ending with the app's exit.
- `tools/validate/enter-room.sh`: relaunch and enter the room (used by the others).
- `tools/validate/netkill.sh` (network loss and resync), `tools/validate/player-lab.sh` (player bench).

## Known limitations

- **Validated on the Vega Virtual Device only.** There was no Fire TV hardware; hardware decode, HDR, real-remote ergonomics and Alexa voice are untested. Release builds were built and checked for leaked credentials, but the walkthroughs ran on debug builds.
- **Rare VVD player race.** About once per session the VVD player races ahead on a start; the watchdog rebuilds it and the TV is back in sync about 3 s later.
- **Video files (MP4/MKV) play over https only** on the VVD; HLS plays over http too. **MKV can't seek** on the VVD, so for MKV the TV follows play/pause only and says so.
- **5.1 audio doesn't decode** on the VVD; content is seeded with stereo audio.
- **Live channels** aren't supported on TV (a notice is shown, and live leadership is declined so the room keeps working).
- **Voice/camera** aren't available on TV; the voice roster is shown.
- **Role changes apply on re-entering a room**: Inox doesn't push permission changes over the socket.
- The session ID is stored in Vega's AsyncStorage (unencrypted app storage), never the password.
- Built and tested against Inox at commit `321f83b`. Later Inox versions add a room-wide playback speed (up to 3×); the TV doesn't follow it, because changing `playbackRate` stalls the VVD's media pipeline.

## Inox and what's new

Inox is the owner's pre-existing watch-party platform (Go backend, React web client). It existed before the submission period, is **not modified** by this project, and its code is not part of this repository. Everything here was built during the hackathon: the Vega TV app, the shared core package, the mock backend and all tooling.

## Credits and licences

- *Big Buck Bunny* © Blender Foundation, CC-BY 3.0 (local stack demo content).
- The player integration builds on Amazon's Vega hls.js sample (`apps/vega/src/hlsjsplayer`, `PlayerBase.ts`, `PlayerInterface.ts`), used under its own licence terms; see the file headers.
- hls.js (Apache-2.0), as patched by Amazon for Vega.
- Emoji rendered by the platform's Noto Color Emoji font.
