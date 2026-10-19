import React, {memo, useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import type {SyncStatus} from '../../../../../packages/core/src';
import {color, font, layer, motion, radius, space} from '../../theme/tokens';
import {Pill} from '../ui/Pill';

interface Props {
  roomName: string;
  /** What the room is playing; null while nothing is known. */
  mediaTitle: string | null;
  canControl: boolean;
  /** Null hides the pill (unknown, live media, or a file that can't seek). */
  sync: SyncStatus | null;
  voiceCount: number;
  /** Adds "▼ Library" to the hint row (members who can control playback). */
  libraryHint: boolean;
  /** Changes on every remote key: the banner re-appears and its hide timer restarts. */
  wakeKey: number;
  /** Kept visible while true (the control bar is open). */
  pinned: boolean;
}

/**
 * Top-left room status (tv-ux.md, Room screen): room, title, who controls playback, sync and voice.
 * It fades out after motion.bannerHideMs without a key press and is unmounted once hidden, so
 * nothing sits over the video while idle.
 */
export const StatusBanner = memo(({roomName, mediaTitle, canControl, sync, voiceCount, libraryHint, wakeKey, pinned}: Props) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (pinned) return;
    const t = setTimeout(() => setVisible(false), motion.bannerHideMs);
    return () => clearTimeout(t);
  }, [wakeKey, pinned, mediaTitle]);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    const anim = Animated.timing(opacity, {toValue: visible ? 1 : 0, duration: visible ? motion.fast : motion.standard, useNativeDriver: true});
    anim.start(({finished}) => {
      if (finished && !visible) setMounted(false);
    });
    return () => anim.stop();
  }, [visible, mounted, opacity]);

  if (!mounted) return null;
  const hints = ['▲ React', '☰ Chat', 'OK Controls', ...(libraryHint ? ['▼ Library'] : [])].join('  ·  ');
  return (
    <Animated.View style={[styles.root, {opacity}]} accessibilityRole="header" accessibilityLabel={`${roomName}${mediaTitle ? `, playing ${mediaTitle}` : ''}`}>
      <Text style={styles.room} numberOfLines={1}>
        {roomName}
      </Text>
      {mediaTitle ? (
        <Text style={styles.title} numberOfLines={1}>
          {mediaTitle}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.control}>{canControl ? 'You control playback' : '🔒 Following the host'}</Text>
        {sync === 'in-sync' ? <Pill icon="●" label="In sync" tone="success" /> : null}
        {sync === 'catching-up' ? <Pill icon="↻" label="Catching up…" tone="warning" /> : null}
        {voiceCount > 0 ? <Pill icon="🎧" label={`${voiceCount} in voice`} /> : null}
      </View>
      <Text style={styles.hint}>{hints}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: space.safeY,
    left: space.safeX,
    maxWidth: '46%',
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: space.xs,
    zIndex: layer.banner,
  },
  room: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  title: {color: color.text, fontSize: font.body},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs},
  control: {color: color.textMuted, fontSize: font.caption},
  hint: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs},
});
