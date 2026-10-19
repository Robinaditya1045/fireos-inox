// Wire types mirrored from Inox at commit 321f83b. Field names stay snake_case, exactly as sent.
// Sources: backend/internal/domain/{session,room,media,chat}.go, backend/internal/ws/event.go,
// frontend/src/types/ws.ts.

export interface Session {
  id: string;
  user_id: string;
  username: string;
  email: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
  expires_at: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
}

export type MediaKind = 'vod' | 'live';

export interface RoomActivity {
  viewers: number;
  is_playing: boolean;
  media_url?: string;
  kind?: MediaKind;
}

export interface Room {
  id: string;
  name: string;
  owner_id: string;
  is_private: boolean;
  current_media_url: string;
  created_at: string;
  updated_at: string;
  activity?: RoomActivity;
}

export interface Permissions {
  can_control_playback: boolean;
  can_stream_audio: boolean;
  can_stream_video: boolean;
  can_share_screen: boolean;
  can_send_messages: boolean;
  can_invite_users: boolean;
  can_kick_users: boolean;
  can_manage_roles: boolean;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  username?: string;
  role: 'owner' | 'moderator' | 'member' | 'guest';
  permissions: Permissions;
  joined_at: string;
}

export interface MediaRendition {
  id: string;
  resolution: string;
  bitrate_kbps: number;
  playlist_url: string;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  title: string;
  description: string;
  source_url: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  duration_seconds: number;
  thumbnail_url: string;
  hls_master_url: string;
  /** Omitted when empty (domain/media.go omitempty); the mock sends null. */
  renditions?: MediaRendition[] | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
}

export type WSEventType =
  | 'JOIN_ROOM'
  | 'LEAVE_ROOM'
  | 'CHAT_MESSAGE'
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'CHANGE_MEDIA'
  | 'SYNC_PLAYBACK'
  | 'SFU_PEERS'
  | 'LIVE_POSITION'
  | 'LIVE_LEADER'
  | 'LIVE_STATUS'
  | 'ERROR'
  | string;

export interface WSMessage<T = unknown> {
  type: WSEventType;
  room_id?: string;
  sender_id?: string;
  sender_name?: string;
  target_id?: string;
  payload?: T;
  timestamp: number;
}

export interface PlaybackPayload {
  media_url?: string;
  is_playing?: boolean;
  media_time_seconds: number;
  last_updated?: number;
  kind?: MediaKind;
  leader_id?: string;
  leader_name?: string;
}

export interface ChatPayload {
  message: string;
}

export interface SfuPeer {
  user_id: string;
  username: string;
  is_muted: boolean;
  is_camera_on: boolean;
  is_screen_sharing: boolean;
}

export interface LiveLeaderPayload {
  leader_id: string;
  leader_name: string;
}

export interface LivePositionPayload {
  position: { sn: number; cc: number; offset: number };
  age_ms: number;
  stalled?: boolean;
  unable?: boolean;
}

export const PLAYBACK_EVENTS = new Set<WSEventType>(['PLAY', 'PAUSE', 'SEEK', 'CHANGE_MEDIA']);

export function isPlaybackPayload(p: unknown): p is PlaybackPayload {
  return typeof p === 'object' && p !== null && typeof (p as PlaybackPayload).media_time_seconds === 'number';
}

export function isChatPayload(p: unknown): p is ChatPayload {
  return typeof p === 'object' && p !== null && typeof (p as ChatPayload).message === 'string';
}

export function isSfuPeersPayload(p: unknown): p is { peers: SfuPeer[] | null } {
  if (typeof p !== 'object' || p === null) return false;
  const peers = (p as { peers?: unknown }).peers;
  // Go encodes an empty roster slice as null (contract §6).
  return peers === null || (Array.isArray(peers) && peers.every((x) => typeof x === 'object' && x !== null && typeof (x as SfuPeer).user_id === 'string'));
}

export function isLiveLeaderPayload(p: unknown): p is LiveLeaderPayload {
  return typeof p === 'object' && p !== null && typeof (p as LiveLeaderPayload).leader_id === 'string';
}

export function parseMessage(raw: string): WSMessage | null {
  try {
    const m = JSON.parse(raw) as WSMessage;
    return typeof m === 'object' && m !== null && typeof m.type === 'string' ? m : null;
  } catch {
    return null;
  }
}
