import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {color, font, radius, space} from '../../theme/tokens';

/** Placeholder block for content that is loading. Static on purpose: no looping animation on TV. */
export const Skeleton = ({style}: {style?: StyleProp<ViewStyle>}) => <View style={[styles.block, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;

/** The shape of a lobby card while rooms load. */
export const SkeletonCard = ({style}: {style?: StyleProp<ViewStyle>}) => (
  <View style={[styles.card, style]}>
    <Skeleton style={styles.line1} />
    <Skeleton style={styles.line2} />
    <Skeleton style={styles.line3} />
  </View>
);

const styles = StyleSheet.create({
  block: {backgroundColor: color.surfaceRaised, borderRadius: radius.sm},
  card: {backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, gap: space.md},
  line1: {height: font.heading, width: '70%'},
  line2: {height: font.caption, width: '50%'},
  line3: {height: font.caption, width: '35%'},
});
