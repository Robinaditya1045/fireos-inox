import { isPlaybackPayload, PLAYBACK_EVENTS, type MediaKind, type WSMessage } from './protocol';

/**
 * The room's playback position as an anchor ("position X at local time T"), extrapolated on
 * demand. Storing a moving currentTime instead would drift with every render tick.
 */
export interface PlaybackState {
  mediaUrl: string;
  kind: MediaKind;
  isPlaying: boolean;
  anchorTime: number;
  anchorLocalMs: number;
}

/** Inox's web client only trusts a sender-clock latency below 5 s (PlayerSyncProvider.tsx). */
const MAX_LATENCY_S = 5;
/** Seek when further off than this. Must stay well inside the 1 s cross-client target. */
export const DRIFT_SEEK_THRESHOLD_S = 0.5;
export const SETTLE_MS = 2000;

/**
 * Device clock minus server clock. The hub stamps SYNC_PLAYBACK with the server clock
 * (ws/hub.go registerClient), so each (re)connect gives a fresh estimate; it over-reads by the
 * one-way latency, which is milliseconds on a LAN. Measured on VVD: the device clock runs
 * ~0.75 s behind the host, enough to matter for `last_updated` arithmetic.
 */
export function clockOffsetFromSync(msg: WSMessage, localNowMs: number): number {
  return msg.type === 'SYNC_PLAYBACK' && msg.timestamp > 0 ? localNowMs - msg.timestamp : 0;
}

function latencySeconds(senderMs: number | undefined, localNowMs: number, clockOffsetMs: number): number {
  if (!senderMs) return 0;
  const latency = (localNowMs - (senderMs + clockOffsetMs)) / 1000;
  return latency > 0 && latency < MAX_LATENCY_S ? latency : 0;
}

/** SYNC_PLAYBACK: the authoritative state sent on every (re)connect. */
export function fromSync(msg: WSMessage, localNowMs: number, clockOffsetMs = 0): PlaybackState | null {
  const p = msg.payload;
  if (!isPlaybackPayload(p)) return null;
  let anchorTime = p.media_time_seconds;
  if (p.is_playing && p.last_updated) {
    anchorTime += Math.max(0, (localNowMs - (p.last_updated + clockOffsetMs)) / 1000);
  }
  return {
    mediaUrl: p.media_url ?? '',
    kind: p.kind ?? 'vod',
    isPlaying: !!p.is_playing,
    anchorTime,
    anchorLocalMs: localNowMs,
  };
}

/** Whether a message is this client's own playback event echoed back by the hub (which fans out to the sender too). */
export function isOwnEcho(msg: WSMessage, myUserId: string): boolean {
  return PLAYBACK_EVENTS.has(msg.type) && msg.sender_id === myUserId;
}

/** Applies a remote PLAY/PAUSE/SEEK/CHANGE_MEDIA. Returns the input state for anything else. */
export function applyRemote(s: PlaybackState, msg: WSMessage, localNowMs: number, clockOffsetMs = 0): PlaybackState {
  const p = msg.payload;
  switch (msg.type) {
    case 'PLAY':
      if (!isPlaybackPayload(p)) return s;
      return { ...s, isPlaying: true, anchorTime: p.media_time_seconds + latencySeconds(msg.timestamp, localNowMs, clockOffsetMs), anchorLocalMs: localNowMs };
    case 'PAUSE':
      if (!isPlaybackPayload(p)) return s;
      return { ...s, isPlaying: false, anchorTime: p.media_time_seconds, anchorLocalMs: localNowMs };
    case 'SEEK':
      if (!isPlaybackPayload(p)) return s;
      return { ...s, anchorTime: p.media_time_seconds, anchorLocalMs: localNowMs };
    case 'CHANGE_MEDIA':
      if (!isPlaybackPayload(p) || !p.media_url) return s;
      return { mediaUrl: p.media_url, kind: p.kind ?? 'vod', isPlaying: false, anchorTime: 0, anchorLocalMs: localNowMs };
    default:
      return s;
  }
}

/** A local action (this client pressed play/pause/seek): re-anchor at the given position. */
export function applyLocal(s: PlaybackState, isPlaying: boolean, position: number, localNowMs: number): PlaybackState {
  return { ...s, isPlaying, anchorTime: position, anchorLocalMs: localNowMs };
}

export function expectedPosition(s: PlaybackState, localNowMs: number): number {
  return s.isPlaying ? s.anchorTime + (localNowMs - s.anchorLocalMs) / 1000 : s.anchorTime;
}

/** Seek-only drift policy, for players whose playbackRate cannot be changed. */
export function correction(expected: number, actual: number, inSettleWindow: boolean): { seek: boolean; drift: number } {
  const drift = expected - actual;
  return { seek: !inSettleWindow && Math.abs(drift) > DRIFT_SEEK_THRESHOLD_S, drift };
}

/**
 * Drift ladder, after Inox's live-sync ladder (frontend/src/utils/liveSync.ts): a seek costs a
 * rebuffer (~2.3 s measured on VVD), so small gaps are closed by playback rate (verified to work on
 * the Vega player) and only large ones by seeking.
 * `drift` = expected − actual (positive: behind the room).
 */
export function driftAction(drift: number): { rate: number; seek: boolean } {
  const m = Math.abs(drift);
  if (m < 0.15) return { rate: 1, seek: false };
  // Above 1.5 s a seek (landing `lead` ahead) recovers in ~one rebuffer; rate 1.15 would need 10 s+.
  if (m > 1.5) return { rate: 1, seek: true };
  const step = m < 0.5 ? 0.05 : 0.15;
  return { rate: drift > 0 ? 1 + step : 1 - step, seek: false };
}

/**
 * A seek while playing costs a rebuffer, so the player lands behind the target by its start-up
 * latency. Seeking to `expected + lead` absorbs that; the lead learns from the drift left over once
 * a seek has settled (bounded to [0, 2] s).
 */
export function nextLead(lead: number, residualDrift: number): number {
  return Math.min(2, Math.max(0, lead + 0.8 * residualDrift));
}

/** Payload that hands live-sync leadership back (ws/live.go reassigns on `unable`). */
export function declineLeadershipPayload() {
  return { position: { sn: 0, cc: 0, offset: 0 }, age_ms: 0, unable: true };
}
