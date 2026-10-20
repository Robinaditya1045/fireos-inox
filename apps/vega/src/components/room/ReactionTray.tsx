import React, {memo} from 'react';
import {StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {QUICK_REPLIES, REACTIONS} from '../../../../../packages/core/src';
import {color, font, layer, motion, radius, space} from '../../theme/tokens';
import {FocusButton} from '../FocusButton';
import {EmojiKey} from './EmojiKey';
import {useIdleTimeout} from './useIdleTimeout';

interface Props {
  wakeKey: number;
  onIdle: () => void;
  onReaction: (emoji: string) => void;
  onQuickReply: (text: string) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}

/**
 * Couch Reactions (D17): the reaction set as large keys and a row of quick replies. Focus starts on
 * the first reaction and is trapped in the tray. It stays open after a reaction (the echo floats
 * over the video), and hides after motion.trayHideMs without a key press.
 */
export const ReactionTray = memo(({wakeKey, onIdle, onReaction, onQuickReply, onLayout}: Props) => {
  useIdleTimeout(motion.trayHideMs, wakeKey, onIdle);
  return (
    <View style={styles.root} onLayout={onLayout}>
      <Text style={styles.title}>Send a reaction</Text>
      <TVFocusGuideView style={styles.body} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <View style={styles.reactions}>
          {REACTIONS.map((emoji, i) => (
            <EmojiKey key={emoji} testID={`reaction-${i}`} emoji={emoji} size="large" hasTVPreferredFocus={i === 0} onPress={() => onReaction(emoji)} />
          ))}
        </View>
        {[QUICK_REPLIES.slice(0, 3), QUICK_REPLIES.slice(3)].map((row, r) => (
          <View key={r} style={styles.replies}>
            {row.map((text, i) => (
              <FocusButton key={text} testID={`quick-reply-${r * 3 + i}`} label={text} accessibilityLabel={`Send: ${text}`} compact onPress={() => onQuickReply(text)} />
            ))}
          </View>
        ))}
      </TVFocusGuideView>
      <Text style={styles.hint}>Everyone in the room sees it · Back closes</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: space.safeX,
    right: space.safeX,
    bottom: space.safeY,
    alignItems: 'center',
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    gap: space.md,
    zIndex: layer.overlay,
  },
  title: {color: color.text, fontSize: font.body, fontWeight: '700'},
  body: {alignItems: 'center', gap: space.lg},
  reactions: {flexDirection: 'row', gap: space.lg},
  replies: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md},
  hint: {color: color.textMuted, fontSize: font.caption},
});
