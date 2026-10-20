import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {logger} from '../platform/logger';
import {color, focus, font, radius, size, space} from '../theme/tokens';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Shown under the field, e.g. why the last submit was refused. */
  error?: string | null;
  // Optional, for other text than URLs (sign-in). The defaults are the Custom URL keyboard's.
  /** Shortcut keys above the letters; an empty list hides the row. */
  snippets?: readonly string[];
  /** Shown while the field is empty. */
  placeholder?: string;
  /** Shown under the field when there is no error. */
  hint?: string;
  /** What the field is called, for the screen reader. */
  fieldLabel?: string;
  /** Masks the value as ••• and adds a Show/Hide key. */
  secure?: boolean;
  /** Label of the submit key. */
  submitLabel?: string;
  /** Shift also turns the digit row into its symbols (!@#…), as on a physical keyboard. */
  shiftSymbols?: boolean;
  /** Shorter field and keys, so the whole keyboard fits a 540-high canvas inside the safe area. */
  compact?: boolean;
}

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_./', ':?=&%~#+@,'];
const SNIPPETS = ['https://', 'www.', '.com', '.mp4', '.mkv', '.m3u8'];
const DIGIT_SYMBOLS: Record<string, string> = {1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')'};

/**
 * A D-pad keyboard for typing a media URL. VVD shows no system keyboard for a TextInput (R18), so
 * the TV draws its own: characters a URL needs, a shift for case-sensitive paths, and snippets for
 * the parts every link has. The optional props reuse it for sign-in.
 */
export const UrlKeyboard = ({
  value,
  onChange,
  onSubmit,
  error,
  snippets = SNIPPETS,
  placeholder = 'https://example.com/video.mp4',
  hint = 'An https:// link to an MP4 or MKV file, or an HLS (.m3u8) stream',
  fieldLabel = 'Video URL',
  secure,
  submitLabel = '▶ Play',
  shiftSymbols,
  compact,
}: Props) => {
  const [upper, setUpper] = useState(false);
  const [reveal, setReveal] = useState(false);
  const type = (text: string) => onChange(value + text);
  const masked = secure && !reveal;
  const shown = masked ? '•'.repeat(value.length) : value;
  // Without snippets, an empty field starts on the first letter key instead.
  const preferFirstKey = !value && snippets.length === 0;

  return (
    <View>
      <View style={[styles.field, compact && styles.fieldCompact]} accessibilityLabel={`${fieldLabel}: ${value ? (masked ? `${value.length} characters, hidden` : value) : 'empty'}`}>
        <Text style={value ? styles.value : styles.placeholder}>{value ? `${shown}▏` : placeholder}</Text>
      </View>
      {error ? <Text style={[styles.error, compact && styles.messageCompact]}>{error}</Text> : <Text style={[styles.hint, compact && styles.messageCompact]}>{hint}</Text>}
      {snippets.length > 0 ? (
        <View style={styles.row}>
          {snippets.map((snippet, i) => (
            <Key key={snippet} id={`url-snippet-${snippet}`} label={snippet} onPress={() => type(snippet)} grow preferred={!value && i === 0} compact={compact} />
          ))}
        </View>
      ) : null}
      {ROWS.map((row, r) => (
        <View key={row} style={styles.row}>
          {[...row].map((ch, i) => {
            const c = upper ? (shiftSymbols && DIGIT_SYMBOLS[ch]) || ch.toUpperCase() : ch;
            return <Key key={ch} id={`url-key-${ch}`} label={c} onPress={() => type(c)} preferred={preferFirstKey && r === 0 && i === 0} compact={compact} />;
          })}
        </View>
      ))}
      <View style={styles.row}>
        <Key id="url-shift" label={upper ? '⇧ abc' : '⇧ ABC'} onPress={() => setUpper((u) => !u)} grow compact={compact} />
        <Key id="url-delete" label="⌫ Delete" onPress={() => onChange(value.slice(0, -1))} grow compact={compact} />
        <Key id="url-clear" label="Clear" onPress={() => onChange('')} grow compact={compact} />
        {secure ? <Key id="url-reveal" label={reveal ? 'Hide' : 'Show'} onPress={() => setReveal((v) => !v)} grow compact={compact} /> : null}
        <Key id="url-play" label={submitLabel} onPress={onSubmit} grow accent preferred={!!value} compact={compact} />
      </View>
    </View>
  );
};

interface KeyProps {
  id: string;
  label: string;
  onPress: () => void;
  grow?: boolean;
  accent?: boolean;
  preferred?: boolean;
  compact?: boolean;
}

const Key = ({id, label, onPress, grow, accent, preferred, compact}: KeyProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id});
      }}
      onBlur={() => setFocused(false)}
      style={[styles.key, compact && styles.keyCompact, grow && styles.grow, focused && styles.focused, accent && styles.accent]}>
      <Text style={styles.keyLabel}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  field: {backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, minHeight: size.fieldMinHeight, justifyContent: 'center'},
  fieldCompact: {minHeight: size.fieldMinHeightCompact, paddingVertical: space.xs},
  value: {color: color.text, fontSize: font.caption},
  placeholder: {color: color.textMuted, fontSize: font.caption},
  hint: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs, marginBottom: space.md},
  error: {color: color.danger, fontSize: font.caption, marginTop: space.xs, marginBottom: space.md},
  messageCompact: {marginBottom: space.xs},
  row: {flexDirection: 'row', gap: space.xs, marginBottom: space.xs},
  key: {
    flex: 1,
    minHeight: size.keyHeight,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  keyCompact: {minHeight: size.keyHeightCompact},
  grow: {paddingHorizontal: space.xs},
  // After `focused` in the style list, so the action key keeps its fill (white text, AA) when focused.
  accent: {backgroundColor: color.accentStrong},
  focused: {borderColor: color.text, backgroundColor: color.surfaceRaised, transform: [{scale: focus.scale}]},
  keyLabel: {color: color.text, fontSize: font.caption, fontWeight: '600'},
});
