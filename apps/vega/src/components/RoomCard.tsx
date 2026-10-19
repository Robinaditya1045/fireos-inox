import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {LobbyCard} from '../../../../packages/core/src';
import {logger} from '../platform/logger';
import {color, focus, font, radius, space} from '../theme/tokens';
import {Pill} from './ui/Pill';

interface Props {
  card: LobbyCard;
  width: number;
  preferred: boolean;
  testID: string;
  onPress: () => void;
  onFocus: () => void;
}

/**
 * A lobby card. An occupied room leads with what is playing; an empty one with its name and what it
 * played last. Status is a pill with an icon (never colour alone); long names truncate.
 */
export const RoomCard = ({card, width, preferred, testID, onPress, onFocus}: Props) => {
  const [focused, setFocused] = useState(false);
  const {room, title, status, viewers} = card;
  const live = status !== 'idle';
  const lock = room.is_private ? '🔒 ' : '';
  const heading = live && title ? title : `${lock}${room.name}`;
  const detail = live ? (title ? `${lock}${room.name}` : 'Nothing picked yet') : title ? `Last played: ${title}` : 'Nothing played yet';
  const watching = `${viewers} watching`;
  const a11y = [
    room.name,
    room.is_private ? 'private room' : null,
    status === 'playing' ? `playing ${title ?? 'a video'}` : status === 'paused' ? `paused on ${title ?? 'a video'}` : 'nobody here yet',
    live ? watching : title ? `last played ${title}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        logger.debug('focus', 'button', {id: testID});
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.card, {width}, focused && styles.focused]}>
      <Text style={styles.heading} numberOfLines={1}>
        {heading}
      </Text>
      <Text style={styles.detail} numberOfLines={1}>
        {detail}
      </Text>
      <View style={styles.pills}>
        {status === 'playing' ? <Pill icon="▶" label="Playing" tone="success" /> : null}
        {status === 'paused' ? <Pill icon="❚❚" label="Paused" tone="warning" /> : null}
        {live ? <Pill icon="👥" label={watching} /> : <Pill label="Nobody here yet" />}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
    padding: space.lg,
    gap: space.xs,
  },
  focused: {borderColor: color.text, backgroundColor: color.surfaceHigh, transform: [{scale: focus.scale}]},
  heading: {color: color.text, fontSize: font.body, fontWeight: '700'},
  detail: {color: color.textMuted, fontSize: font.caption},
  pills: {flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs},
});
