import React from 'react';
import {StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {color, font, radius, space} from '../theme/tokens';
import type {Tone} from './ui/Toast';

// Same icons and edges as Toast, so a tone never relies on colour alone.
const ICON: Record<Tone, string> = {info: 'ℹ', success: '✓', warning: '!', danger: '✕'};
const EDGE: Record<Tone, string> = {info: color.accent, success: color.success, warning: color.warning, danger: color.danger};
const FILL: Record<Tone, string> = {info: color.accentSoft, success: color.successSoft, warning: color.warningSoft, danger: color.dangerSoft};

/** A message in the page flow (sign-in error, "session ended", stale lobby data). Not focusable. */
export const InlineNotice = ({tone, text, style}: {tone: Tone; text: string; style?: StyleProp<ViewStyle>}) => (
  <View style={[styles.root, {backgroundColor: FILL[tone], borderLeftColor: EDGE[tone]}, style]} accessibilityLiveRegion="polite" accessibilityRole={tone === 'danger' ? 'alert' : 'text'}>
    <Text style={[styles.icon, {color: EDGE[tone]}]}>{ICON[tone]}</Text>
    <Text style={styles.text}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: {flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, borderLeftWidth: 6, paddingVertical: space.xs, paddingHorizontal: space.md},
  icon: {fontSize: font.caption, fontWeight: '700'},
  text: {color: color.text, fontSize: font.caption, flexShrink: 1},
});
