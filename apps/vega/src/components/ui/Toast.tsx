import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, font, layer, radius, space} from '../../theme/tokens';

export type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  text: string;
  tone?: Tone;
}

const ICON: Record<Tone, string> = {info: 'ℹ', success: '✓', warning: '!', danger: '✕'};
const EDGE: Record<Tone, string> = {info: color.accent, success: color.success, warning: color.warning, danger: color.danger};

/**
 * A short message at the bottom centre. The tone shows as an icon and a coloured edge, so it never
 * relies on colour alone. Pair it with useTimedValue for auto-dismiss.
 */
export const Toast = ({message}: {message: ToastMessage | null}) => {
  if (!message) return null;
  const tone = message.tone ?? 'info';
  return (
    <View style={[styles.root, {borderLeftColor: EDGE[tone]}]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={[styles.icon, {color: EDGE[tone]}]}>{ICON[tone]}</Text>
      <Text style={styles.text}>{message.text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    bottom: space.xxl * 2,
    alignSelf: 'center',
    maxWidth: '60%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderLeftWidth: 6,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    zIndex: layer.toast,
  },
  icon: {fontSize: font.body, fontWeight: '700'},
  text: {color: color.text, fontSize: font.body, flexShrink: 1},
});
