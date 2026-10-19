import React, {useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {logger} from '../platform/logger';
import {color, focus, font, radius, space} from '../theme/tokens';

interface Props {
  label: string;
  value: string;
  /** Shown when the value is empty. */
  placeholder: string;
  /** Shows the value as •••. */
  secure?: boolean;
  preferred?: boolean;
  testID: string;
  onPress: () => void;
  onFocus?: () => void;
}

/**
 * A form field for the remote: a focusable row showing the label and value; select opens the
 * app-drawn keyboard (VVD shows no system keyboard for a TextInput, R18).
 */
export const TextField = ({label, value, placeholder, secure, preferred, testID, onPress, onFocus}: Props) => {
  const [focused, setFocused] = useState(false);
  const shown = secure ? '•'.repeat(value.length) : value;
  const spoken = value ? (secure ? `${value.length} characters entered` : value) : 'empty';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${spoken}. Select to type.`}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id: testID});
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.root, focused && styles.focused]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={value ? styles.value : styles.placeholder} numberOfLines={1}>
        {value ? shown : placeholder}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  focused: {borderColor: color.text, backgroundColor: color.surfaceHigh, transform: [{scale: focus.scale}]},
  label: {color: color.textMuted, fontSize: font.caption},
  value: {color: color.text, fontSize: font.body},
  placeholder: {color: color.textMuted, fontSize: font.body},
});
