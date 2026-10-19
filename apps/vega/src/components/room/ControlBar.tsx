import React, {memo, useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {color, font, layer, motion, radius, space} from '../../theme/tokens';
import {FocusButton} from '../FocusButton';
import {useIdleTimeout} from './useIdleTimeout';

export interface PlaybackProgress {
  /** Seconds. */
  position: number;
  /** Seconds; 0 or NaN while unknown. */
  duration: number;
  /** What the room is doing (not the local element, which may be holding). */
  playing: boolean;
}

interface Props {
  getProgress: () => PlaybackProgress;
  canControl: boolean;
  /** Seconds per −/+ step. */
  seekStep: number;
  wakeKey: number;
  onIdle: () => void;
  onPlayPause: () => void;
  onSeekBy: (deltaS: number) => void;
  onReact: () => void;
  onChat: () => void;
  /** Absent for members who can't change the media. */
  onLibrary?: () => void;
  /** __DEV__ only: cycles the HLS rendition. */
  onQuality?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}

const PROGRESS_REFRESH_MS = 1000;

/** 0:05, 12:34, 1:02:03. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * The bottom control bar (select): progress, play state and one row of actions. Focus starts on
 * Play/Pause and is trapped in the row. Members without playback control see 🔒 on the playback
 * buttons; pressing one goes through the same permission check as the media keys (toast, nothing
 * sent). It hides after motion.controlsHideMs without a key press.
 */
export const ControlBar = memo((props: Props) => {
  const {getProgress, canControl, seekStep, wakeKey, onIdle, onPlayPause, onSeekBy, onReact, onChat, onLibrary, onQuality, onLayout} = props;
  const [progress, setProgress] = useState<PlaybackProgress>(getProgress);
  const refresh = useCallback(() => setProgress(getProgress()), [getProgress]);

  useEffect(() => {
    const t = setInterval(refresh, PROGRESS_REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);
  useIdleTimeout(motion.controlsHideMs, wakeKey, onIdle);

  const {position, duration, playing} = progress;
  const known = Number.isFinite(duration) && duration > 0;
  const fraction = known ? Math.min(1, Math.max(0, position / duration)) : 0;
  const lock = canControl ? undefined : '🔒';
  const hostOnly = canControl ? '' : ', host only';

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={styles.progressRow} accessibilityLabel={`${playing ? 'Playing' : 'Paused'}, ${clock(position)}${known ? ` of ${clock(duration)}` : ''}`}>
        <Text style={styles.state}>{playing ? '▶ Playing' : '❚❚ Paused'}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, {flex: fraction}]} />
          <View style={[styles.rest, {flex: 1 - fraction}]} />
        </View>
        <Text style={styles.time}>{known ? `${clock(position)} / ${clock(duration)}` : clock(position)}</Text>
      </View>
      <TVFocusGuideView style={styles.buttons} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <FocusButton
          testID="controls-playpause"
          icon={lock ?? (playing ? '❚❚' : '▶')}
          label={playing ? 'Pause' : 'Play'}
          accessibilityLabel={`${playing ? 'Pause' : 'Play'}${hostOnly}`}
          variant="primary"
          compact
          hasTVPreferredFocus
          onPress={() => {
            onPlayPause();
            refresh();
          }}
        />
        <FocusButton
          testID="controls-back"
          icon={lock ?? '◀◀'}
          label={`−${seekStep} s`}
          accessibilityLabel={`Back ${seekStep} seconds${hostOnly}`}
          compact
          onPress={() => {
            onSeekBy(-seekStep);
            refresh();
          }}
        />
        <FocusButton
          testID="controls-forward"
          icon={lock ?? '▶▶'}
          label={`+${seekStep} s`}
          accessibilityLabel={`Forward ${seekStep} seconds${hostOnly}`}
          compact
          onPress={() => {
            onSeekBy(seekStep);
            refresh();
          }}
        />
        <View style={styles.spacer} />
        <FocusButton testID="controls-react" icon="☺" label="React" accessibilityLabel="Send a reaction" compact onPress={onReact} />
        <FocusButton testID="controls-chat" icon="☰" label="Chat" accessibilityLabel="Open chat" compact onPress={onChat} />
        {onLibrary ? <FocusButton testID="controls-library" icon="▼" label="Library" accessibilityLabel="Open the media library" compact onPress={onLibrary} /> : null}
        {onQuality ? <FocusButton testID="controls-quality" icon="⚙" label="Quality" accessibilityLabel="Cycle video quality (debug)" variant="ghost" compact onPress={onQuality} /> : null}
      </TVFocusGuideView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    bottom: space.safeY,
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    gap: space.lg,
    zIndex: layer.overlay,
  },
  progressRow: {flexDirection: 'row', alignItems: 'center', gap: space.lg},
  state: {color: color.text, fontSize: font.caption, fontWeight: '600', minWidth: space.xxl * 3},
  track: {flex: 1, flexDirection: 'row', height: space.xs, borderRadius: radius.sm, backgroundColor: color.surfaceHigh, overflow: 'hidden'},
  fill: {backgroundColor: color.accent, borderRadius: radius.sm},
  rest: {backgroundColor: 'transparent'},
  time: {color: color.text, fontSize: font.caption, fontVariant: ['tabular-nums']},
  buttons: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  spacer: {flex: 1},
});
