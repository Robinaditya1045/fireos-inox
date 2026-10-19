// PlayerAdapter for Vega: W3C VideoPlayer + Amazon's patched hls.js (MSE mode), wired the way
// Amazon's hls.js sample (hls-rel v1.5.11-r1.7) does it, for HLS; single files (MP4, MKV, …) use the
// player's URL mode (`src`, react-native-w3cmedia README "URL Mode playback"). The video surface
// handle arrives later, from KeplerVideoSurfaceView, via attachSurface().
// @ts-nocheck — the vendored hls.js bundle and w3cmedia polyfills ship without usable types.
import {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {HlsJsPlayer} from '../hlsjsplayer/HlsJsPlayer';
import * as HlsLib from '../hlsjsplayer/dist/hls.mjs';
import Document from '../hlsjsplayer/polyfills/DocumentPolyfill';
import Element from '../hlsjsplayer/polyfills/ElementPolyfill';
import TextDecoderPolyfill from '../hlsjsplayer/polyfills/TextDecoderPolyfill';
import W3CMediaPolyfill from '../hlsjsplayer/polyfills/W3CMediaPolyfill';
import MiscPolyfill from '../hlsjsplayer/polyfills/MiscPolyfill';
import {isHlsUrl} from '../../../../packages/core/src';
import {logger} from '../platform/logger';

let polyfillsInstalled = false;

/**
 * HTML timers treat clearing an unknown, already-fired or undefined handle as a no-op; Vega's
 * native clearTimeout/clearInterval throw "called with an invalid handle" instead. hls.js clears
 * timers it may not hold (14 `self.clearTimeout` call sites), so without this its fragment loader
 * dies on the first segment and unload() throws (verified on VVD, SDK 0.24.12112).
 */
function installSpecTimerSemantics() {
  for (const name of ['clearTimeout', 'clearInterval'] as const) {
    const native = global[name];
    const safe = (handle: unknown) => {
      if (handle === undefined || handle === null) return;
      try {
        native(handle);
      } catch {
        // invalid or expired handle: spec says do nothing
      }
    };
    global[name] = safe;
    if (global.window) global.window[name] = safe;
    if (global.self) global.self[name] = safe;
  }
}

function installPolyfills() {
  if (polyfillsInstalled) return;
  installSpecTimerSemantics();
  Document.install();
  Element.install();
  TextDecoderPolyfill.install();
  W3CMediaPolyfill.install();
  MiscPolyfill.install();
  polyfillsInstalled = true;
}

function timeRanges(r: {length: number; start(i: number): number; end(i: number): number} | undefined): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < (r?.length ?? 0); i++) out.push([r.start(i), r.end(i)]);
  return out;
}

export interface LevelInfo {
  index: number;
  height: number;
  bitrate: number;
}

// After a fatal network error hls.js has spent its own retries and stops loading for good. Inox's
// web client restarts it with backoff (WatchPartyPlayer.tsx RETRY_BASE_MS/RETRY_MAX_MS); so do we.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
/**
 * In URL mode `buffered` stays empty on VVD (readyState still reaches HAVE_FUTURE_DATA), so
 * bufferedAhead() reports this much once the player says it can play on.
 */
const FILE_READY_AHEAD_S = 10;

export class VegaPlayer {
  private video: VideoPlayer | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private hls: HlsJsPlayer | null = null;
  /** The hls.js instance our listeners are on; HlsJsPlayer reuses one instance across loads. */
  private listening: unknown = null;
  private url: string | null = null;
  /** How the current URL plays: hls.js over MSE, or the player's URL mode for a single file. */
  private mode: 'hls' | 'file' = 'hls';
  private surface: string | null = null;
  private resetting = false;
  private hlsConfig: Record<string, unknown> = {};
  private ready = false;
  private readyListeners: Array<() => void> = [];
  private levelListeners: Array<(l: LevelInfo) => void> = [];
  private bufferingListeners: Array<(buffering: boolean) => void> = [];
  private errorListeners: Array<(code: number | undefined) => void> = [];

  async init(): Promise<void> {
    this.video = new VideoPlayer();
    global.gmedia = this.video;
    await this.video.initialize();
    this.video.autoplay = false;
    installPolyfills();
    this.video.addEventListener('loadedmetadata', () => {
      this.ready = true;
      logger.info('player', 'loadedmetadata', {duration: this.video?.duration, seekable: timeRanges(this.video?.seekable)});
      this.readyListeners.forEach((cb) => cb());
    });
    this.video.addEventListener('waiting', () => {
      logger.debug('player', 'waiting', {at: this.video?.currentTime, readyState: this.video?.readyState});
      this.bufferingListeners.forEach((cb) => cb(true));
    });
    this.video.addEventListener('playing', () => {
      logger.debug('player', 'playing', {at: this.video?.currentTime});
      this.bufferingListeners.forEach((cb) => cb(false));
    });
    this.video.addEventListener('error', () => {
      const code = this.video?.error?.code;
      logger.error('player', 'media element error', {code, message: this.video?.error?.message});
      this.errorListeners.forEach((cb) => cb(code));
    });
  }

  /** `hlsConfig` overrides the sample's hls.js settings (read live by hls.js; used by the player lab). */
  load(url: string, hlsConfig: Record<string, unknown> = {}): void {
    if (!this.video) return;
    this.ready = false;
    this.url = url;
    this.hlsConfig = hlsConfig;
    this.mode = isHlsUrl(url) ? 'hls' : 'file';
    if (this.mode === 'file') {
      // URL mode: the player fetches and demuxes the file itself. Only the first load lands here
      // with a fresh element; later loads come through switchTo()/reset(), which drop hls.js first.
      // The src setter loads by itself (MediaPlayer.setSrcWithCustomHeaders), so no load() here.
      this.video.src = url;
      logger.info('player', 'load', {url, mode: 'file'});
      return;
    }
    if (this.hls) {
      void this.hls.unload();
    } else {
      this.hls = new HlsJsPlayer(this.video);
    }
    this.hls.load({secure: 'false', uri: url, drm_scheme: '', drm_license_uri: ''}, false);
    const hls = this.hls.player;
    Object.assign(hls.config, hlsConfig);
    logger.info('player', 'load', {url});
    if (this.listening === hls) return;
    this.listening = hls;
    hls.on(HlsLib.Events.LEVEL_SWITCHED, (_e, data) => {
      const level = hls.levels?.[data.level];
      const info = {index: data.level, height: level?.height ?? 0, bitrate: level?.bitrate ?? 0};
      logger.info('player', 'LEVEL_SWITCHED', info);
      this.levelListeners.forEach((cb) => cb(info));
    });
    hls.on(HlsLib.Events.ERROR, (_e, data) => {
      const ctx = {type: data?.type, details: data?.details, fatal: !!data?.fatal, reason: data?.reason ?? String(data?.error ?? '')};
      if (!data?.fatal) {
        logger.warn('player', 'hls error', ctx);
        return;
      }
      logger.error('player', 'hls error', ctx);
      if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
        this.scheduleRetry();
      }
    });
    hls.on(HlsLib.Events.FRAG_LOADED, () => {
      this.retryAttempt = 0;
    });
  }


  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.retryAttempt - 1));
    logger.info('player', 'restarting load after fatal network error', {attempt: this.retryAttempt, delay});
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.recoverNetwork();
    }, delay);
  }

  /** Restarts loading now (e.g. when the room socket has just reconnected). */
  recoverNetwork(): void {
    const hls = this.hls?.player;
    if (hls) {
      hls.startLoad(this.video?.currentTime ?? -1);
    } else if (this.url && this.video?.error) {
      // A file that failed to load has no loader to restart; a rebuild fetches it again.
      void this.reset();
    }
  }

  attachSurface(handle: string): void {
    this.surface = handle;
    this.video?.setSurfaceHandle(handle);
  }

  detachSurface(handle: string): void {
    if (this.surface === handle) this.surface = null;
    this.video?.clearSurfaceHandle(handle);
  }

  /**
   * Switches to another stream (CHANGE_MEDIA). On VVD, loading a second stream into the element that
   * played the first never reached loadedmetadata (media library switch, 2026-10-17; player lab 0/2
   * for a reload into the same element), so a switch rebuilds the element through reset().
   */
  switchTo(url: string): Promise<void> {
    if (!this.url) {
      this.load(url, this.hlsConfig);
      return Promise.resolve();
    }
    this.url = url;
    this.ready = false;
    return this.reset();
  }

  /**
   * Rebuilds the media element and hls.js from scratch and reloads the current stream; onReady
   * listeners fire again once it is back. On VVD a player that raced or wedged after a resume (R17)
   * came back 2/2 this way, against 0/2 for reloading into the same element and 1/2 for
   * hls.recoverMediaError() (player lab, .devstack/evidence/lab-inox-recovery.txt).
   */
  async reset(): Promise<void> {
    if (this.resetting) return;
    this.resetting = true;
    logger.warn('player', 'resetting media element', {url: this.url});
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      await this.hls?.destroy();
      await this.video?.deinitialize();
    } catch (err) {
      logger.warn('player', 'reset teardown failed', {err: String(err)});
    }
    this.hls = null;
    this.listening = null;
    this.video = null;
    this.ready = false;
    try {
      await this.init();
      if (this.surface) this.video?.setSurfaceHandle(this.surface);
      // The current URL, not the one at the start: a switchTo() during the rebuild must win.
      if (this.url) this.load(this.url, this.hlsConfig);
    } finally {
      this.resetting = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  onReady(cb: () => void): void {
    this.readyListeners.push(cb);
  }

  onLevel(cb: (l: LevelInfo) => void): void {
    this.levelListeners.push(cb);
  }

  onBuffering(cb: (buffering: boolean) => void): void {
    this.bufferingListeners.push(cb);
  }

  /** The media element failed (MediaError code: 2 network, 3 decode, 4 unsupported source). */
  onError(cb: (code: number | undefined) => void): void {
    this.errorListeners.push(cb);
  }

  play(): void {
    void this.video?.play();
  }

  pause(): void {
    this.video?.pause();
  }

  /** True when the current URL plays as a single file (URL mode) rather than through hls.js. */
  playsFile(): boolean {
    return this.mode === 'file';
  }

  isPaused(): boolean {
    return this.video ? this.video.paused : true;
  }

  seek(seconds: number): void {
    if (this.video) this.video.currentTime = Math.max(0, seconds);
  }

  /** HTMLMediaElement.readyState: 3 (HAVE_FUTURE_DATA) means playback can start without stalling. */
  readyState(): number {
    return this.video?.readyState ?? 0;
  }

  /**
   * Seconds of media buffered contiguously ahead of the playhead. On Vega, readyState can report
   * HAVE_FUTURE_DATA right after a seek while the playhead's range is not buffered yet; play() then
   * makes hls.js gap-jump seconds ahead (seen on VVD). The buffered ranges are the reliable signal,
   * except in URL mode, which reports none.
   */
  bufferedAhead(): number {
    const v = this.video;
    if (!v?.buffered) return 0;
    if (this.mode === 'file' && v.buffered.length === 0) {
      return !v.seeking && v.readyState >= 3 ? FILE_READY_AHEAD_S : 0;
    }
    const t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      const start = v.buffered.start(i);
      const end = v.buffered.end(i);
      if (t >= start - 0.1 && t < end) return end - t;
    }
    return 0;
  }

  isSeeking(): boolean {
    return !!this.video?.seeking;
  }

  setRate(rate: number): void {
    if (this.video && this.video.playbackRate !== rate) this.video.playbackRate = rate;
  }

  rate(): number {
    return this.video?.playbackRate ?? 1;
  }

  currentTime(): number {
    return this.video?.currentTime ?? 0;
  }

  duration(): number {
    return this.video?.duration ?? 0;
  }

  levels(): LevelInfo[] {
    const hls = this.hls?.player;
    return (hls?.levels ?? []).map((l, index) => ({index, height: l.height, bitrate: l.bitrate}));
  }

  /** Forces a rendition (-1 = automatic ABR). Used by the debug HUD to prove switching. */
  setLevel(index: number): void {
    const hls = this.hls?.player;
    if (hls) hls.currentLevel = index;
  }

  /** Raw handles for dev instrumentation (src/dev/PlayerLab.tsx) only. */
  debugHandles(): {video: VideoPlayer | null; hls: unknown; Events: typeof HlsLib.Events} {
    return {video: this.video, hls: this.hls?.player ?? null, Events: HlsLib.Events};
  }

  async destroy(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      await this.hls?.destroy();
      await this.video?.deinitialize();
    } catch (err) {
      logger.warn('player', 'destroy failed', {err: String(err)});
    }
    this.hls = null;
    this.video = null;
    global.gmedia = null;
  }
}
