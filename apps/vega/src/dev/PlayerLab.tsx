// Dev-only player test bench for R17/F6 (VVD player jumping ~5 s ahead on resume/seek). It drives
// VegaPlayer directly — no room, no socket, no sync maths — through scripted trials and logs the
// playhead, buffered ranges and hls.js buffer events, tagged [lab], for tools/validate/analyze-lab.mjs.
// Enabled by `node scripts/write-app-config.mjs --player-lab <url>`; never shipped in release builds.
// @ts-nocheck — hls.js and the W3C media element are untyped here (see VegaPlayer.ts).
import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {logger} from '../platform/logger';
import {VegaPlayer} from '../player/VegaPlayer';
import {color, font, space} from '../theme/tokens';

const SAMPLE_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function ranges(tr): number[][] {
  const out = [];
  for (let i = 0; i < (tr?.length ?? 0); i++) out.push([r3(tr.start(i)), r3(tr.end(i))]);
  return out;
}

export const PlayerLab = ({url, level, hls: hlsConfig, suite = 'basic'}: {url: string; level: number; hls: Record<string, unknown>; suite?: string}) => {
  const player = useRef<VegaPlayer | null>(null);
  const surface = useRef<string | null>(null);
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    let stopped = false;
    const p = new VegaPlayer();
    player.current = p;
    let trial = 'load';
    let last = {t: 0, at: 0};

    (async () => {
      await p.init();
      if (surface.current) p.attachSurface(surface.current);
      let {video} = p.debugHandles();
      const watchVideo = () => {
        video = p.debugHandles().video;
        for (const ev of ['play', 'pause', 'seeking', 'seeked', 'waiting', 'playing', 'stalled', 'ended']) {
          video.addEventListener(ev, () => logger.info('lab', 'EV', {trial, ev, t: r3(video.currentTime), buf: ranges(video.buffered)}));
        }
      };
      watchVideo();
      const ready = new Promise<void>((done) => p.onReady(done));
      p.load(url, hlsConfig);
      const {hls, Events} = p.debugHandles();
      if (level >= 0) hls.currentLevel = level;
      hls.on(Events.FRAG_LOADING, (_e, d) => logger.info('lab', 'FRAG_LOADING', {trial, sn: d.frag.sn, lvl: d.frag.level, start: r3(d.frag.start), dur: r3(d.frag.duration)}));
      hls.on(Events.FRAG_BUFFERED, (_e, d) => logger.info('lab', 'FRAG_BUFFERED', {trial, sn: d.frag.sn, lvl: d.frag.level, start: r3(d.frag.start), buf: ranges(video.buffered)}));
      hls.on(Events.BUFFER_FLUSHING, (_e, d) => logger.info('lab', 'BUFFER_FLUSHING', {trial, start: r3(d.startOffset), end: r3(d.endOffset), type: d.type}));
      hls.on(Events.LEVEL_SWITCHING, (_e, d) => logger.info('lab', 'LEVEL_SWITCHING', {trial, lvl: d.level}));
      hls.on(Events.ERROR, (_e, d) => logger.info('lab', 'HLS_ERROR', {trial, details: d.details, fatal: !!d.fatal, t: r3(video.currentTime), buf: ranges(video.buffered)}));

      const sampler = setInterval(() => {
        const t = video.currentTime;
        const now = Date.now();
        const s = {trial, t: r3(t), paused: video.paused, seeking: video.seeking, rs: video.readyState, buf: ranges(video.buffered)};
        logger.debug('lab', 'S', s);
        const advanced = t - last.t;
        const wall = (now - last.at) / 1000;
        // A playhead step much larger than the wall time that passed is a jump, not playback.
        if (last.at && !video.seeking && advanced > wall + 1) logger.warn('lab', 'JUMP', {...s, from: r3(last.t), by: r3(advanced - wall)});
        last = {t, at: now};
      }, SAMPLE_MS);

      await ready;
      const duration = video.duration;
      logger.info('lab', 'READY', {url, duration: r3(duration), level, hls: hlsConfig});
      const fit = (x: number) => (x < duration - 10 ? x : r3(duration * 0.5));

      /** Plays from `target` and reports where the playhead is `afterS` later vs. where it should be. */
      const measure = async (name: string, target: number, startedAt: number, afterS = 4) => {
        await sleep(afterS * 1000);
        const t = video.currentTime;
        const elapsed = (Date.now() - startedAt) / 1000;
        logger.info('lab', 'RESULT', {trial: name, target, t: r3(t), elapsed: r3(elapsed), ahead: r3(t - (target + elapsed)), buf: ranges(video.buffered)});
      };

      /** Waits until the player is not seeking and has `aheadS` buffered past the playhead (max `maxMs`). */
      const untilBuffered = async (aheadS = 2, maxMs = 6000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < maxMs && (video.seeking || p.bufferedAhead() < aheadS)) await sleep(100);
        return (Date.now() - t0) / 1000;
      };

      /**
       * Pause in place for `pauseS` (optionally after running at `rate`), then resume with `mode`:
       * plain play(); reseek (seek to the paused position, play at once); hold (seek just past it,
       * wait for buffer, play); rate0 (playbackRate 0 instead of pause(), back to 1 to resume).
       */
      const pauseResume = (pauseS: number, rate = 1, mode: 'plain' | 'reseek' | 'hold' | 'rate0' = 'plain'): [string, () => Promise<void>] => [
        `pause${pauseS}s${rate !== 1 ? `-after-rate${rate}` : ''}-${mode}`,
        async () => {
          p.setRate(1);
          p.play();
          await sleep(2000);
          if (rate !== 1) {
            p.setRate(rate);
            await sleep(3000);
            p.setRate(1);
          }
          if (mode === 'rate0') p.setRate(0);
          else p.pause();
          await sleep(300);
          const target = video.currentTime;
          await sleep(pauseS * 1000 - 300);
          logger.info('lab', 'BEFORE_PLAY', {trial, t: r3(video.currentTime), target: r3(target), rate: p.rate(), paused: video.paused, buf: ranges(video.buffered)});
          let resumeAt = target;
          if (mode === 'reseek') p.seek(target);
          if (mode === 'hold') {
            resumeAt = target + 0.05;
            p.seek(resumeAt);
            const waited = await untilBuffered();
            logger.info('lab', 'HOLD_READY', {trial, waited: r3(waited), t: r3(video.currentTime)});
          }
          const at = Date.now();
          if (mode === 'rate0') p.setRate(1);
          else p.play();
          await measure(trial, r3(resumeAt), at);
        },
      ];

      const play0: [string, () => Promise<void>] = ['play-from-0', async () => {
        const at = Date.now();
        p.play();
        await measure('play-from-0', 0, at, 6);
      }];
      const advancing = async (from: number, ms: number) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms && !(video.currentTime > from + 1 && !video.seeking)) await sleep(100);
        return video.currentTime > from + 1;
      };

      /**
       * Starts each trial from a fresh, verifiably advancing position so trials don't inherit a wedged
       * player. A wedged player is recovered with hls.recoverMediaError(), then a full reload: the
       * same ladder the app needs for a stall that a seek does not clear.
       */
      const prepare = async (from: number) => {
        p.setRate(1);
        p.play();
        p.seek(from);
        if (await advancing(from, 6000)) {
          logger.info('lab', 'PREPARED', {trial, from, t: r3(video.currentTime)});
          return true;
        }
        logger.warn('lab', 'UNHEALTHY', {trial, from, t: r3(video.currentTime), rs: video.readyState, buf: ranges(video.buffered)});
        const {hls: h} = p.debugHandles();
        h.recoverMediaError();
        p.seek(from);
        p.play();
        if (await advancing(from, 8000)) {
          logger.info('lab', 'RECOVERED', {trial, how: 'recoverMediaError', t: r3(video.currentTime)});
          return true;
        }
        const reloaded = new Promise<void>((done) => p.onReady(done));
        p.load(url, hlsConfig);
        await Promise.race([reloaded, sleep(10_000)]);
        p.seek(from);
        p.play();
        const ok = await advancing(from, 8000);
        logger[ok ? 'info' : 'error']('lab', ok ? 'RECOVERED' : 'DEAD', {trial, how: 'reload', t: r3(video.currentTime)});
        return ok;
      };

      /** Pauses for `pauseS` from a fresh position and resumes with `mode`; reports at +4 s and +8 s. */
      const resumeTrial = (from: number, pauseS: number, mode: 'plain' | 'play-then-seek' | 'hold' | 'reseek' | 'refresh', rate = 1): [string, () => Promise<void>] => [
        `${mode}@${from}+${pauseS}s${rate !== 1 ? `-after-rate${rate}` : ''}`,
        async () => {
          if (!(await prepare(fit(from)))) return;
          if (rate !== 1) {
            p.setRate(rate);
            await sleep(3000);
            p.setRate(1);
          }
          p.pause();
          await sleep(300);
          const target = video.currentTime;
          const pauseEnd = Date.now() + pauseS * 1000 - 300;
          while (Date.now() < pauseEnd) {
            // refresh: a flushing seek every 5 s, so no single pause outlasts the ≤10 s that resumes cleanly.
            await sleep(Math.min(5000, pauseEnd - Date.now()));
            if (mode === 'refresh' && Date.now() < pauseEnd) p.seek(target);
          }
          logger.info('lab', 'BEFORE_PLAY', {trial, t: r3(video.currentTime), target: r3(target), buf: ranges(video.buffered)});
          if (mode === 'hold' || mode === 'refresh') {
            if (mode === 'hold') p.seek(target);
            logger.info('lab', 'HOLD_READY', {trial, waited: r3(await untilBuffered()), t: r3(video.currentTime)});
          }
          if (mode === 'reseek') p.seek(target);
          const at = Date.now();
          p.play();
          if (mode === 'play-then-seek') p.seek(target);
          await measure(trial, r3(target), at, 4);
          await measure(trial, r3(target), at, 4); // cumulative: elapsed is from `at`, so this is +8 s
        },
      ];

      const resumeSuite: Array<[string, () => Promise<void>]> = [
        play0,
        resumeTrial(10, 20, 'plain'),
        resumeTrial(30, 20, 'play-then-seek'),
        resumeTrial(50, 20, 'hold'),
        resumeTrial(70, 20, 'reseek'),
        resumeTrial(90, 20, 'refresh'),
        resumeTrial(20, 20, 'plain'),
        resumeTrial(40, 20, 'play-then-seek'),
        resumeTrial(60, 20, 'hold'),
        resumeTrial(80, 20, 'reseek'),
        resumeTrial(100, 20, 'refresh'),
      ];

      /** After a fresh position: play `playS` (at `rate` for the first 3 s), pause `pauseS`, resume with `mode`. */
      const driftTrial = (from: number, playS: number, pauseS: number, rate = 1, mode: 'plain' | 'hold' = 'plain'): [string, () => Promise<void>] => [
        `play${playS}s${rate !== 1 ? `-rate${rate}` : ''}-pause${pauseS}s-${mode}@${from}`,
        async () => {
          if (!(await prepare(fit(from)))) return;
          const w0 = Date.now();
          const t0 = video.currentTime;
          if (rate !== 1) {
            p.setRate(rate);
            await sleep(3000);
            p.setRate(1);
          }
          await sleep(playS * 1000 - (rate !== 1 ? 3000 : 0));
          const advanced = video.currentTime - t0;
          const wall = (Date.now() - w0) / 1000;
          logger.info('lab', 'PLAYED', {trial, advanced: r3(advanced), wall: r3(wall), excess: r3(advanced - wall)});
          p.pause();
          await sleep(300);
          const target = video.currentTime;
          await sleep(pauseS * 1000 - 300);
          if (mode === 'hold') {
            p.seek(target);
            logger.info('lab', 'HOLD_READY', {trial, waited: r3(await untilBuffered()), t: r3(video.currentTime)});
          }
          const at = Date.now();
          p.play();
          await measure(trial, r3(target), at, 4);
          await measure(trial, r3(target), at, 4);
        },
      ];

      const driftSuite: Array<[string, () => Promise<void>]> = [
        play0,
        driftTrial(5, 40, 3),
        driftTrial(50, 40, 20),
        driftTrial(95, 5, 20),
        driftTrial(10, 3, 3, 1.15),
        driftTrial(20, 3, 20, 1.15),
        driftTrial(50, 40, 20, 1, 'hold'),
      ];

      const fixSuite: Array<[string, () => Promise<void>]> = [
        play0,
        resumeTrial(10, 20, 'plain'),
        resumeTrial(25, 20, 'hold'),
        resumeTrial(40, 20, 'refresh'),
        resumeTrial(55, 20, 'hold', 1.15),
        resumeTrial(70, 20, 'plain', 1.15),
        resumeTrial(85, 20, 'hold'),
        resumeTrial(100, 20, 'refresh', 1.15),
        resumeTrial(115, 20, 'hold', 1.15),
        resumeTrial(20, 20, 'plain'),
        resumeTrial(35, 20, 'hold'),
        resumeTrial(50, 20, 'refresh'),
        resumeTrial(65, 20, 'hold', 1.15),
      ];

      /** Plays `ms` and reports whether the playhead raced (>1 s ahead of wall time) or froze. */
      const watchStart = async (ms: number) => {
        const t0 = video.currentTime;
        const w0 = Date.now();
        let raced = false;
        while (Date.now() - w0 < ms) {
          await sleep(100);
          if (video.currentTime - t0 > (Date.now() - w0) / 1000 * 1.2 + 1) raced = true;
        }
        const moved = video.currentTime - t0;
        return {raced, frozen: moved < 0.3, moved: r3(moved)};
      };

      /** Provokes R17 (plain resume after a 20 s pause) and, when it hits, tries one recovery method. */
      const methods = ['reload', 'recoverMediaError', 'reset'] as const;
      let methodIdx = 0;
      const recoveryTrial = (from: number): [string, () => Promise<void>] => [
        `provoke@${from}`,
        async () => {
          if (!(await prepare(fit(from)))) return;
          p.pause();
          await sleep(20_000);
          p.play();
          const start = await watchStart(3000);
          logger.info('lab', 'PROVOKED', {trial, ...start});
          if (!start.raced && !start.frozen) return;
          const method = methods[methodIdx++ % methods.length];
          const at = Date.now();
          const {hls: h} = p.debugHandles();
          if (method === 'reload') p.load(url, hlsConfig); // same element and hls.js instance
          else if (method === 'recoverMediaError') h.recoverMediaError();
          else {
            await p.reset();
            watchVideo();
          }
          await Promise.race([new Promise<void>((done) => p.onReady(done)), sleep(8000)]);
          const target = fit(from) + 5;
          p.seek(target);
          await untilBuffered(2, 6000);
          p.play();
          const after = await watchStart(4000);
          logger.info('lab', 'RECOVERY', {trial, method, ok: !after.raced && !after.frozen, ...after, ms: Date.now() - at});
        },
      ];
      const recoverySuite: Array<[string, () => Promise<void>]> = [play0, ...[10, 30, 50, 70, 90, 110, 20, 40, 60, 80, 100, 120].map(recoveryTrial)];

      const pauseSuite: Array<[string, () => Promise<void>]> = [
        play0,
        pauseResume(3),
        pauseResume(6),
        pauseResume(10),
        pauseResume(15),
        pauseResume(10, 1.15),
        pauseResume(10, 1, 'reseek'),
      ];

      const basicSuite: Array<[string, () => Promise<void>]> = [
        ['play-from-0', async () => {
          const at = Date.now();
          p.play();
          await measure('play-from-0', 0, at, 6);
        }],
        // F6 as seen in M0: seek while paused, wait, then play.
        ...[79.2, 45.0, 100.5].map((x): [string, () => Promise<void>] => [`paused-seek-then-play@${fit(x)}`, async () => {
          const target = fit(x);
          p.pause();
          await sleep(1500);
          p.seek(target);
          await sleep(4000);
          logger.info('lab', 'BEFORE_PLAY', {trial, t: r3(video.currentTime), buf: ranges(video.buffered)});
          const at = Date.now();
          p.play();
          await measure(trial, target, at);
        }]),
        ['playing-seek@30', async () => {
          p.play();
          await sleep(1500);
          const at = Date.now();
          p.seek(fit(30));
          await measure(trial, fit(30), at);
        }],
        ['pause-resume-in-place', async () => {
          p.play();
          await sleep(2000);
          p.pause();
          await sleep(3000);
          const target = video.currentTime;
          const at = Date.now();
          p.play();
          await measure(trial, r3(target), at);
        }],
      ];

      const trials = ({pause: pauseSuite, resume: resumeSuite, drift: driftSuite, fix: fixSuite, recovery: recoverySuite} as Record<string, typeof basicSuite>)[suite] ?? basicSuite;
      logger.info('lab', 'SUITE', {suite, trials: trials.map(([n]) => n)});
      for (const [name, run] of trials) {
        if (stopped) return;
        trial = name;
        setStatus(name);
        logger.info('lab', 'TRIAL', {trial});
        await run();
      }
      clearInterval(sampler);
      p.pause();
      logger.info('lab', 'DONE');
      setStatus('done');
    })().catch((err) => logger.error('lab', 'failed', {err: String(err)}));

    return () => {
      stopped = true;
      void p.destroy();
    };
  }, [url, level, hlsConfig, suite]);

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.surface}
        onSurfaceViewCreated={(h: string) => {
          surface.current = h;
          player.current?.attachSurface(h);
        }}
        onSurfaceViewDestroyed={(h: string) => player.current?.detachSurface(h)}
      />
      <Text style={styles.status}>{`player lab · ${status}`}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  surface: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  status: {position: 'absolute', top: space.safeY, left: space.safeX, color: color.text, fontSize: font.body, backgroundColor: color.overlay, padding: space.sm},
});
