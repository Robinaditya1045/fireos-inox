import React, {forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {color, font, layer, motion, radius, space} from '../../theme/tokens';

export interface ChatBubble {
  id: string;
  name: string;
  nameColor: string;
  text: string;
}

export interface ChatBubblesHandle {
  push: (bubble: ChatBubble) => void;
  clear: () => void;
}

/** Bubbles on screen at once; a fourth pushes the oldest out. */
const MAX_BUBBLES = 3;

/**
 * Other people's chat lines while the chat panel is closed (D17): bottom-left, newest at the
 * bottom, each for motion.bubbleMs, two lines at most.
 */
export const ChatBubbles = memo(
  forwardRef<ChatBubblesHandle, {bottomInset: number}>(({bottomInset}, ref) => {
    const [items, setItems] = useState<ChatBubble[]>([]);
    useImperativeHandle(ref, () => ({
      push: (b) => setItems((list) => (list.some((x) => x.id === b.id) ? list : [...list, b].slice(-MAX_BUBBLES))),
      clear: () => setItems([]),
    }));
    const done = useCallback((id: string) => setItems((list) => list.filter((x) => x.id !== id)), []);
    if (items.length === 0) return null;
    return (
      <View style={[styles.root, {bottom: space.safeY + bottomInset}]} accessibilityLiveRegion="polite">
        {items.map((b) => (
          <Bubble key={b.id} bubble={b} onDone={done} />
        ))}
      </View>
    );
  }),
);

const Bubble = memo(({bubble, onDone}: {bubble: ChatBubble; onDone: (id: string) => void}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(opacity, {toValue: 1, duration: motion.standard, useNativeDriver: true});
    anim.start();
    const t = setTimeout(() => onDone(bubble.id), motion.bubbleMs);
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [opacity, onDone, bubble.id]);
  return (
    <Animated.View style={[styles.bubble, {opacity}]}>
      <Text style={styles.text} numberOfLines={2}>
        <Text style={[styles.name, {color: bubble.nameColor}]}>{bubble.name}: </Text>
        {bubble.text}
      </Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {position: 'absolute', left: space.safeX, maxWidth: '38%', gap: space.sm, alignItems: 'flex-start', zIndex: layer.overlay},
  bubble: {backgroundColor: color.overlay, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.lg},
  text: {color: color.text, fontSize: font.caption},
  name: {fontWeight: '700'},
});
