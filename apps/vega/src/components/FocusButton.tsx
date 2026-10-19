import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {logger} from '../platform/logger';
import {color, focus, font, radius, size, space} from '../theme/tokens';

export type FocusButtonVariant = 'secondary' | 'primary' | 'ghost';

interface Props {
  label: string;
  sublabel?: string;
  /** A glyph shown before the label (emoji or symbol). */
  icon?: string;
  onPress: () => void;
  variant?: FocusButtonVariant;
  /** Smaller padding and caption-size text, for toolbars and tab rows. */
  compact?: boolean;
  /** Marks the selected tab or option; announced and shown with a dot, never by colour alone. */
  selected?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** A focusable card/button with a visible focus state that never relies on colour alone. */
export const FocusButton = ({
  label,
  sublabel,
  icon,
  onPress,
  variant = 'secondary',
  compact,
  selected,
  hasTVPreferredFocus,
  style,
  testID,
  accessibilityLabel,
  onFocus,
  onBlur,
}: Props) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (sublabel ? `${label}, ${sublabel}` : label)}
      accessibilityState={selected === undefined ? undefined : {selected}}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id: testID ?? label});
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      style={[styles.base, compact && styles.compact, styles[variant], focused && styles.focused, focused && variant !== 'primary' && styles.focusedFill, style]}>
      <View style={styles.row}>
        {icon ? <Text style={[styles.icon, compact && styles.iconCompact]}>{icon}</Text> : null}
        <Text style={[styles.label, compact && styles.labelCompact, variant === 'primary' && styles.labelOnAccent]} numberOfLines={1}>
          {label}
        </Text>
        {selected ? <View style={styles.selectedDot} /> : null}
      </View>
      {sublabel ? (
        <Text style={[styles.sublabel, variant === 'primary' && styles.labelOnAccent]} numberOfLines={2}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  compact: {paddingVertical: space.xs, paddingHorizontal: space.lg},
  secondary: {backgroundColor: color.surface},
  primary: {backgroundColor: color.accentStrong},
  ghost: {backgroundColor: 'transparent'},
  focused: {borderColor: color.text, transform: [{scale: focus.scale}]},
  focusedFill: {backgroundColor: color.surfaceHigh},
  row: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  icon: {fontSize: font.body, color: color.text},
  iconCompact: {fontSize: font.caption},
  label: {color: color.text, fontSize: font.body, fontWeight: '600', flexShrink: 1},
  labelCompact: {fontSize: font.caption},
  labelOnAccent: {color: color.onAccent},
  selectedDot: {width: size.dot, height: size.dot, borderRadius: size.dot / 2, backgroundColor: color.accent, marginLeft: space.xs},
  sublabel: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs},
});
