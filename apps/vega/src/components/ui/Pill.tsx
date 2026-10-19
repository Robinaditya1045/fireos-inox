import React from 'react';
import {StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {color, font, radius, space} from '../../theme/tokens';
import type {Tone} from './Toast';

const FILL: Record<Tone | 'neutral', string> = {
  neutral: color.surfaceRaised,
  info: color.accentSoft,
  success: color.successSoft,
  warning: color.warningSoft,
  danger: color.dangerSoft,
};
const INK: Record<Tone | 'neutral', string> = {
  neutral: color.textMuted,
  info: color.text,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
};

/** A small status label (▶ Playing, 2 watching, In sync). The icon carries the meaning, not the colour. */
export const Pill = ({label, icon, tone = 'neutral', style}: {label: string; icon?: string; tone?: Tone | 'neutral'; style?: StyleProp<ViewStyle>}) => (
  <View style={[styles.root, {backgroundColor: FILL[tone]}, style]}>
    {icon ? <Text style={[styles.text, {color: INK[tone]}]}>{icon}</Text> : null}
    <Text style={[styles.text, {color: INK[tone]}]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: {flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: space.md},
  text: {fontSize: font.caption, fontWeight: '600'},
});
