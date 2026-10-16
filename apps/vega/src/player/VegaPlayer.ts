// PlayerAdapter for Vega: W3C VideoPlayer + Amazon's patched hls.js (MSE mode), wired the way
// Amazon's hls.js sample (hls-rel v1.5.11-r1.7) does it. The video surface handle arrives later,
// from KeplerVideoSurfaceView, via attachSurface().
// @ts-nocheck — the vendored hls.js bundle and w3cmedia polyfills ship without usable types.
import {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {HlsJsPlayer} from '../hlsjsplayer/HlsJsPlayer';
import * as HlsLib from '../hlsjsplayer/dist/hls.mjs';
import Document from '../hlsjsplayer/polyfills/DocumentPolyfill';
import Element from '../hlsjsplayer/polyfills/ElementPolyfill';
import TextDecoderPolyfill from '../hlsjsplayer/polyfills/TextDecoderPolyfill';
import W3CMediaPolyfill from '../hlsjsplayer/polyfills/W3CMediaPolyfill';
import MiscPolyfill from '../hlsjsplayer/polyfills/MiscPolyfill';
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

export interface LevelInfo {
  index: number;
  height: number;
  bitrate: number;
}

// After a fatal network error hls.js has spent its own retries and stops loading for good. Inox's
// web client restarts it with backoff (WatchPartyPlayer.tsx RETRY_BASE_MS/RETRY_MAX_MS); so do we.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

export class VegaPlayer {
  private video: VideoPlayer | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private hls: HlsJsPlayer | null = null;
  /** The hls.js instance our listeners are on; HlsJsPlayer reuses one instance across loads. */
  private listening: unknown = null;
  private url: string | null = null;
  private surface: string | null = null;
  private resetting = false;
  private hlsConfig: Record<string, unknown> = {};
  private ready = false;
  private readyListeners: Array<() => void> = [];
  private levelListeners: Array<(l: LevelInfo) => void> = [];
  private bufferingListeners: Array<(buffering: boolean) => void> = [];

  async init(): Promise<void> {
    this.video = new VideoPlayer();
    global.gmedia = this.video;
    await this.video.initialize();
    this.video.autoplay = false;
    installPolyfills();
    this.video.addEventListener('loadedmetadata', () => {
      this.ready = true;
      logger.info('player', 'loadedmetadata', {duration: this.video?.duration});
      this.readyListeners.forEach((cb) => cb());
    });
    this.video.addEventListener('waiting', () => this.bufferingListeners.forEach((cb) => cb(true)));
    this.video.addEventListener('playing', () => this.bufferingListeners.forEach((cb) => cb(false)));
    this.video.addEventListener('error', () =>
      logger.error('player', 'media element error', {code: this.video?.error?.code, message: this.video?.error?.message}),
    );
  }

  /** `hlsConfig` overrides the sample's hls.js settings (read live by hls.js; used by the player lab). */
  load(url: string, hlsConfig: Record<string, unknown> = {}): void {
    if (!this.video) return;
    this.ready = false;
    this.url = url;
    this.hlsConfig = hlsConfig;
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

  /** Restarts hls.js loading now (e.g. when the room socket has just reconnected). */
  recoverNetwork(): void {
    const hls = this.hls?.player;
    if (!hls) return;
    hls.startLoad(this.video?.currentTime ?? -1);
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
   * Rebuilds the media element and hls.js from scratch and reloads the current stream; onReady
   * listeners fire again once it is back. On VVD a player that raced or wedged after a resume (R17)
   * came back 2/2 this way, against 0/2 for reloading into the same element and 1/2 for
   * hls.recoverMediaError() (player lab, .devstack/evidence/lab-inox-recovery.txt).
   */
  async reset(): Promise<void> {
    if (this.resetting) return;
    this.resetting = true;
    const url = this.url;
    logger.warn('player', 'resetting media element', {url});
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
      if (url) this.load(url, this.hlsConfig);
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

  play(): void {
    void this.video?.play();
  }

  pause(): void {
    this.video?.pause();
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
   * makes hls.js gap-jump seconds ahead (seen on VVD). The buffered ranges are the reliable signal.
   */
  bufferedAhead(): number {
    const v = this.video;
    if (!v?.buffered) return 0;
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
