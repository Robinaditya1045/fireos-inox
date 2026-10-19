import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, font, radius, space} from '../theme/tokens';

/** The app's brand: a play mark and "Inox". `large` on Boot and Sign-in, `small` in headers. */
export const Wordmark = ({size = 'large'}: {size?: 'large' | 'small'}) => {
  const small = size === 'small';
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="Inox">
      <View style={[styles.mark, small && styles.markSmall]}>
        <Text style={[styles.glyph, small && styles.glyphSmall]}>▶</Text>
      </View>
      <Text style={[styles.text, small && styles.textSmall]}>Inox</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  mark: {width: space.xxl, height: space.xxl, borderRadius: radius.md, backgroundColor: color.accentStrong, alignItems: 'center', justifyContent: 'center'},
  markSmall: {width: space.xl, height: space.xl, borderRadius: radius.sm},
  glyph: {color: color.onAccent, fontSize: font.body, fontWeight: '700'},
  glyphSmall: {fontSize: font.caption},
  text: {color: color.text, fontSize: font.display, fontWeight: '800'},
  textSmall: {fontSize: font.heading},
});
