import React, {memo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, font, layer, radius, space} from '../../theme/tokens';
import type {Tone} from '../ui/Toast';

const ICON: Record<Tone, string> = {info: 'ℹ', success: '✓', warning: '!', danger: '✕'};
const EDGE: Record<Tone, string> = {info: color.accent, success: color.success, warning: color.warning, danger: color.danger};

interface Props {
  title: string;
  detail?: string | null;
  tone: Tone;
  /** `center`: over the middle of the video (live, media errors); `inline`: placed by its container. */
  placement: 'center' | 'inline';
}

/**
 * A persistent, non-focusable room notice (live media, a video that can't play, a file that can't
 * skip). The tone shows as an icon and a coloured edge, never by colour alone.
 */
export const NoticeCard = memo(({title, detail, tone, placement}: Props) => (
  <View style={[styles.root, placement === 'center' ? styles.center : styles.inline, {borderLeftColor: EDGE[tone]}]} accessibilityRole="alert">
    <Text style={[styles.icon, {color: EDGE[tone]}]}>{ICON[tone]}</Text>
    <View style={styles.body}>
      <Text style={placement === 'center' ? styles.title : styles.titleSmall}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  </View>
));

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    borderLeftWidth: space.xs - 2,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  center: {position: 'absolute', top: '40%', alignSelf: 'center', maxWidth: '50%', paddingVertical: space.lg, paddingHorizontal: space.xl, zIndex: layer.notice},
  inline: {maxWidth: '100%'},
  icon: {fontSize: font.body, fontWeight: '700'},
  body: {flexShrink: 1, gap: space.xs},
  title: {color: color.text, fontSize: font.body, fontWeight: '700'},
  titleSmall: {color: color.text, fontSize: font.caption},
  detail: {color: color.textMuted, fontSize: font.caption},
});
