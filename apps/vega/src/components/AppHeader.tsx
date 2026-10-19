import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, font, radius, size, space} from '../theme/tokens';
import {Wordmark} from './Wordmark';

/** Top bar of a signed-in screen: wordmark and page title on the left, `right` (user chip, actions) on the right. */
export const AppHeader = ({title, right}: {title: string; right?: React.ReactNode}) => (
  <View style={styles.root}>
    <View style={styles.left}>
      <Wordmark size="small" />
      <View style={styles.divider} />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
    {right ? <View style={styles.right}>{right}</View> : null}
  </View>
);

/** Who is signed in: an initial in a circle and the username. Not focusable. */
export const UserChip = ({username}: {username: string}) => (
  <View style={styles.chip} accessible accessibilityLabel={`Signed in as ${username}`}>
    <View style={styles.avatar}>
      <Text style={styles.initial}>{(username[0] ?? '?').toUpperCase()}</Text>
    </View>
    <Text style={styles.username} numberOfLines={1}>
      {username}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  root: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg},
  left: {flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1},
  divider: {width: size.hairline, height: space.xl, backgroundColor: color.border},
  title: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  right: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  chip: {flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.surfaceRaised, borderRadius: radius.pill, paddingVertical: space.xs, paddingLeft: space.xs, paddingRight: space.lg, maxWidth: size.chipMaxWidth},
  avatar: {width: space.xl, height: space.xl, borderRadius: radius.pill, backgroundColor: color.accentStrong, alignItems: 'center', justifyContent: 'center'},
  initial: {color: color.onAccent, fontSize: font.caption, fontWeight: '700'},
  username: {color: color.text, fontSize: font.caption, fontWeight: '600', flexShrink: 1},
});
