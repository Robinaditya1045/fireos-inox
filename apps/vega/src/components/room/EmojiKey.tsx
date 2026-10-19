import React, {memo, useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {logger} from '../../platform/logger';
import {color, focus, font, radius, space} from '../../theme/tokens';

/** Spoken names for the reaction set (core REACTIONS), so a screen reader doesn't read raw emoji. */
const NAMES: Record<string, string> = {
  '😂': 'laughing',
  '😮': 'surprised',
  '🔥': 'fire',
  '👏': 'applause',
  '❤️': 'love',
  '❤': 'love',
  '😢': 'sad',
};

export const reactionName = (emoji: string): string => NAMES[emoji] ?? emoji;

interface Props {
  emoji: string;
  onPress: () => void;
  /** `large` for the reaction tray, `small` for the chat panel's compact row. */
  size: 'large' | 'small';
  testID: string;
  hasTVPreferredFocus?: boolean;
}

/** A focusable emoji key. Focus shows as a white ring, a raised fill and a scale-up, never by colour alone. */
export const EmojiKey = memo(({emoji, onPress, size, testID, hasTVPreferredFocus}: Props) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`React with ${reactionName(emoji)}`}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id: testID});
      }}
      onBlur={() => setFocused(false)}
      style={[styles.base, size === 'large' ? styles.large : styles.small, focused && styles.focused]}>
      <Text style={size === 'large' ? styles.glyphLarge : styles.glyphSmall}>{emoji}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  large: {paddingVertical: space.sm, paddingHorizontal: space.lg},
  small: {flex: 1, paddingVertical: space.xs, borderRadius: radius.md},
  focused: {borderColor: color.text, backgroundColor: color.surfaceHigh, transform: [{scale: focus.scale}]},
  glyphLarge: {fontSize: font.reaction, lineHeight: font.reaction * 1.2},
  glyphSmall: {fontSize: font.heading, lineHeight: font.heading * 1.25},
});
