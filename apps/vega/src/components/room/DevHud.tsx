import React, {memo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {LevelInfo} from '../../player/VegaPlayer';
import {color, font, radius, space} from '../../theme/tokens';

interface Props {
  connection: string;
  hud: {expected: number; actual: number; drift: number; playing: boolean};
  level: LevelInfo | null;
}

const fmt = (n: number, digits: number) => (Number.isFinite(n) ? n.toFixed(digits) : '—');

/** __DEV__ only: socket, room vs TV position and the HLS rendition. Placed by RoomScreen (top-right). */
export const DevHud = memo(({connection, hud, level}: Props) => (
  <View style={styles.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Text style={styles.text}>{`ws ${connection} · ${hud.playing ? 'playing' : 'paused'} · room ${fmt(hud.expected, 1)}s · tv ${fmt(hud.actual, 1)}s · drift ${fmt(hud.drift, 2)}s`}</Text>
    <Text style={styles.text}>{level ? `rendition ${level.height}p (level ${level.index})` : 'rendition —'}</Text>
  </View>
));

const styles = StyleSheet.create({
  root: {backgroundColor: color.overlay, borderRadius: radius.sm, padding: space.sm, alignItems: 'flex-end'},
  text: {color: color.text, fontSize: font.caption},
});
