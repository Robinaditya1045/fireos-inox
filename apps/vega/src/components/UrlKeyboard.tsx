import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {logger} from '../platform/logger';
import {color, focus, font, radius, space} from '../theme/tokens';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Shown under the field, e.g. why the last submit was refused. */
  error?: string | null;
}

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_./', ':?=&%~#+@,'];
const SNIPPETS = ['https://', 'www.', '.com', '.mp4', '.mkv', '.m3u8'];

/**
 * A D-pad keyboard for typing a media URL. VVD shows no system keyboard for a TextInput (R18), so
 * the TV draws its own: characters a URL needs, a shift for case-sensitive paths, and snippets for
 * the parts every link has.
 */
export const UrlKeyboard = ({value, onChange, onSubmit, error}: Props) => {
  const [upper, setUpper] = useState(false);
  const type = (text: string) => onChange(value + text);

  return (
    <View>
      <View style={styles.field} accessibilityLabel={`Video URL: ${value || 'empty'}`}>
        <Text style={value ? styles.value : styles.placeholder}>{value ? `${value}▏` : 'https://example.com/video.mp4'}</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.hint}>An https:// link to an MP4 or MKV file, or an HLS (.m3u8) stream</Text>}
      <View style={styles.row}>
        {SNIPPETS.map((snippet, i) => (
          <Key key={snippet} id={`url-snippet-${snippet}`} label={snippet} onPress={() => type(snippet)} grow preferred={!value && i === 0} />
        ))}
      </View>
      {ROWS.map((row) => (
        <View key={row} style={styles.row}>
          {[...row].map((ch) => {
            const c = upper ? ch.toUpperCase() : ch;
            return <Key key={ch} id={`url-key-${ch}`} label={c} onPress={() => type(c)} />;
          })}
        </View>
      ))}
      <View style={styles.row}>
        <Key id="url-shift" label={upper ? '⇧ abc' : '⇧ ABC'} onPress={() => setUpper((u) => !u)} grow />
        <Key id="url-delete" label="⌫ Delete" onPress={() => onChange(value.slice(0, -1))} grow />
        <Key id="url-clear" label="Clear" onPress={() => onChange('')} grow />
        <Key id="url-play" label="▶ Play" onPress={onSubmit} grow accent preferred={!!value} />
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
}

const Key = ({id, label, onPress, grow, accent, preferred}: KeyProps) => {
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
      style={[styles.key, grow && styles.grow, accent && styles.accent, focused && styles.focused]}>
      <Text style={styles.keyLabel}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  field: {backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, minHeight: 96, justifyContent: 'center'},
  value: {color: color.text, fontSize: font.caption},
  placeholder: {color: color.textMuted, fontSize: font.caption},
  hint: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs, marginBottom: space.md},
  error: {color: color.danger, fontSize: font.caption, marginTop: space.xs, marginBottom: space.md},
  row: {flexDirection: 'row', gap: space.xs, marginBottom: space.xs},
  key: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  grow: {paddingHorizontal: space.xs},
  accent: {backgroundColor: color.accent},
  focused: {borderColor: color.text, backgroundColor: color.surfaceRaised, transform: [{scale: focus.scale}]},
  keyLabel: {color: color.text, fontSize: font.caption, fontWeight: '600'},
});
