import React, {forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Animated, Easing, StyleSheet, Text, View, type DimensionValue} from 'react-native';
import {colorIndex} from '../../../../../packages/core/src';
import {color, font, layer, motion, radius, space} from '../../theme/tokens';

export interface FloatingReaction {
  /** The chat message ID: unique per reaction, and the seed of its horizontal jitter. */
  id: string;
  emoji: string;
  name: string;
  /** The sender's name colour (authorColors). */
  nameColor: string;
}

export interface FloatingReactionsHandle {
  push: (reaction: FloatingReaction) => void;
}

interface Props {
  /** Distance from the right edge; moves left of the chat panel while it is open. */
  right: DimensionValue;
  /** Extra lift above the safe area while a bottom overlay (control bar, tray) is open. */
  bottomInset: number;
}

/** Concurrent floats; a burst beyond this drops the oldest. */
const MAX_FLOATS = 12;
/** How far a reaction rises, and the jitter grid (from tokens: 432 px and ±4 × 24 px). */
const RISE = space.xxl * 9;
const JITTER_STEPS = 9;
const JITTER_STEP = space.lg;
const SWAY = space.lg;

/**
 * Couch Reactions over the video (D17): each reaction floats up from the lower right with its
 * sender's name and fades out over motion.reactionFloatMs. Native-driver transforms and opacity
 * only; nothing loops, and nothing is rendered while no reaction is in flight.
 */
export const FloatingReactions = memo(
  forwardRef<FloatingReactionsHandle, Props>(({right, bottomInset}, ref) => {
    const [items, setItems] = useState<FloatingReaction[]>([]);
    useImperativeHandle(ref, () => ({
      push: (r) => setItems((list) => (list.some((x) => x.id === r.id) ? list : [...list, r].slice(-MAX_FLOATS))),
    }));
    const done = useCallback((id: string) => setItems((list) => list.filter((x) => x.id !== id)), []);
    if (items.length === 0) return null;
    return (
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.root, {right, bottom: space.safeY + bottomInset}]}>
        {items.map((r) => (
          <Float key={r.id} reaction={r} onDone={done} />
        ))}
      </View>
    );
  }),
);

const Float = memo(({reaction, onDone}: {reaction: FloatingReaction; onDone: (id: string) => void}) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(t, {toValue: 1, duration: motion.reactionFloatMs, easing: Easing.out(Easing.quad), useNativeDriver: true});
    anim.start(({finished}) => {
      if (finished) onDone(reaction.id);
    });
    return () => anim.stop();
  }, [t, onDone, reaction.id]);

  // Deterministic per message: the same reaction lands in the same lane on every TV.
  const x = (colorIndex(reaction.id, JITTER_STEPS) - (JITTER_STEPS - 1) / 2) * JITTER_STEP;
  const sway = colorIndex(`${reaction.id}~`, 2) === 0 ? SWAY : -SWAY;
  const style = {
    opacity: t.interpolate({inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0]}),
    transform: [
      {translateX: t.interpolate({inputRange: [0, 0.5, 1], outputRange: [x, x + sway, x - sway / 2]})},
      {translateY: t.interpolate({inputRange: [0, 1], outputRange: [0, -RISE]})},
      {scale: t.interpolate({inputRange: [0, 0.12, 1], outputRange: [0.6, 1.15, 1]})},
    ],
  };
  return (
    <Animated.View style={[styles.float, style]}>
      <Text style={styles.emoji}>{reaction.emoji}</Text>
      <View style={styles.chip}>
        <Text style={[styles.name, {color: reaction.nameColor}]} numberOfLines={1}>
          {reaction.name}
        </Text>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {position: 'absolute', width: space.xxl * 7, height: RISE + font.reaction * 2, zIndex: layer.overlay},
  float: {position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center'},
  emoji: {fontSize: font.reaction, lineHeight: font.reaction * 1.2},
  chip: {backgroundColor: color.overlay, borderRadius: radius.pill, paddingVertical: space.xs / 2, paddingHorizontal: space.sm, maxWidth: space.xxl * 5},
  name: {fontSize: font.caption, fontWeight: '700'},
});
