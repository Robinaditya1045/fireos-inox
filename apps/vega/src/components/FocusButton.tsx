import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, type StyleProp, type ViewStyle} from 'react-native';
import {logger} from '../platform/logger';
import {color, focus, font, radius, space} from '../theme/tokens';

interface Props {
  label: string;
  sublabel?: string;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  onFocus?: () => void;
}

/** A focusable card/button with a visible focus state that never relies on colour alone. */
export const FocusButton = ({label, sublabel, onPress, hasTVPreferredFocus, style, testID, onFocus}: Props) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id: testID ?? label});
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.base, focused && styles.focused, style]}>
      <Text style={styles.label}>{label}</Text>
      {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  focused: {
    borderColor: color.accent,
    backgroundColor: color.surfaceRaised,
    transform: [{scale: focus.scale}],
  },
  label: {color: color.text, fontSize: font.body, fontWeight: '600'},
  sublabel: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs},
});
