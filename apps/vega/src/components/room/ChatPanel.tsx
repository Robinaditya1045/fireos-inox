import React, {memo, useRef} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {colorIndex, isReaction, QUICK_REPLIES, REACTIONS, trimChat, type ChatMessage} from '../../../../../packages/core/src';
import {authorColors, color, font, layer, space} from '../../theme/tokens';
import {FocusButton} from '../FocusButton';
import {Pill} from '../ui/Pill';
import {EmojiKey} from './EmojiKey';

/** Messages shown (tv-ux.md); the session keeps more. */
const SHOWN = 50;
/** The panel has room for the reactions and a few replies under the messages; the tray (up) has all of them. */
const PANEL_REPLIES = QUICK_REPLIES.slice(0, 4);

export const authorColor = (userId: string): string => authorColors[colorIndex(userId, authorColors.length)] ?? color.accent;

interface Props {
  messages: ChatMessage[];
  meId: string;
  /** People in the room: viewers seen on the socket plus you. */
  hereCount: number;
  voiceCount: number;
  canChat: boolean;
  onReaction: (emoji: string) => void;
  onQuickReply: (text: string) => void;
  onClose: () => void;
}

/**
 * The chat panel (menu): right 30%, translucent, newest message at the bottom. Members who may chat
 * get a compact row of reactions and quick replies at the bottom, where focus starts; others get a
 * read-only line. Back or menu closes it (RoomScreen).
 */
export const ChatPanel = memo(({messages, meId, hereCount, voiceCount, canChat, onReaction, onQuickReply, onClose}: Props) => {
  const scroll = useRef<ScrollView>(null);
  const shown = messages.slice(-SHOWN);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Chat
        </Text>
        <Pill label={`${hereCount} here`} />
        {voiceCount > 0 ? <Pill icon="🎧" label={`${voiceCount} in voice`} /> : null}
      </View>
      <ScrollView
        ref={scroll}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => scroll.current?.scrollToEnd({animated: false})}>
        {shown.length === 0 ? <Text style={styles.empty}>No messages yet</Text> : null}
        {shown.map((m) => {
          const own = m.user_id === meId;
          const name = own ? 'You' : m.username;
          const nameStyle = [styles.name, {color: authorColor(m.user_id)}];
          return isReaction(m.message) ? (
            <View key={m.id} style={styles.reactionRow} accessibilityLabel={`${name} reacted ${trimChat(m.message)}`}>
              <Text style={nameStyle}>{name}</Text>
              <Text style={styles.reaction}>{trimChat(m.message)}</Text>
            </View>
          ) : (
            <Text key={m.id} style={styles.line}>
              <Text style={nameStyle}>{name}: </Text>
              {m.message}
            </Text>
          );
        })}
      </ScrollView>
      {canChat ? (
        <TVFocusGuideView style={styles.compose} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View style={styles.reactions}>
            {REACTIONS.map((emoji, i) => (
              <EmojiKey key={emoji} testID={`chat-reaction-${i}`} emoji={emoji} size="small" hasTVPreferredFocus={i === 0} onPress={() => onReaction(emoji)} />
            ))}
          </View>
          <View style={styles.replies}>
            {PANEL_REPLIES.map((text, i) => (
              <FocusButton key={text} testID={`chat-reply-${i}`} label={text} accessibilityLabel={`Send: ${text}`} compact onPress={() => onQuickReply(text)} />
            ))}
          </View>
        </TVFocusGuideView>
      ) : (
        <TVFocusGuideView style={styles.compose} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <Text style={styles.readOnly}>Chat is read-only for you in this room</Text>
          <FocusButton testID="chat-close" icon="✕" label="Close chat" compact hasTVPreferredFocus onPress={onClose} />
        </TVFocusGuideView>
      )}
      <Text style={styles.hint}>☰ or Back closes</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '34%',
    backgroundColor: color.overlay,
    paddingTop: space.safeY,
    paddingBottom: space.safeY,
    paddingLeft: space.lg,
    paddingRight: space.safeX,
    gap: space.md,
    zIndex: layer.panel,
  },
  header: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm},
  title: {color: color.text, fontSize: font.heading, fontWeight: '700', marginRight: space.xs},
  // Clipped: without it Vega draws scrolled-off messages over the header.
  list: {flex: 1, overflow: 'hidden'},
  listContent: {gap: space.sm, paddingBottom: space.xs},
  empty: {color: color.textMuted, fontSize: font.caption},
  line: {color: color.text, fontSize: font.caption},
  name: {fontWeight: '700', fontSize: font.caption},
  reactionRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm},
  reaction: {fontSize: font.heading, lineHeight: font.heading * 1.3},
  compose: {gap: space.sm},
  reactions: {flexDirection: 'row', gap: space.xs},
  replies: {flexDirection: 'row', flexWrap: 'wrap', gap: space.xs},
  readOnly: {color: color.textMuted, fontSize: font.caption},
  hint: {color: color.textMuted, fontSize: font.caption},
});
