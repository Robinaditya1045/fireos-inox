import React, {memo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, font, layer, radius, space} from '../../theme/tokens';
import {FocusButton} from '../FocusButton';

export type ConnectionMode = 'connecting' | 'reconnecting' | 'offline';

const TEXT: Record<ConnectionMode, {icon: string; text: string}> = {
  connecting: {icon: '↻', text: 'Connecting…'},
  reconnecting: {icon: '↻', text: 'Reconnecting…'},
  offline: {icon: '!', text: "Can't reach Inox"},
};

/**
 * Top-centre socket status, non-blocking: the video keeps playing locally. After a long outage it
 * offers one Retry (RoomScreen decides when). The button is only rendered while no overlay owns
 * focus, so it can take focus without stealing it from one.
 */
export const ConnectionBanner = memo(({mode, showRetry, onRetry}: {mode: ConnectionMode; showRetry: boolean; onRetry: () => void}) => (
  <View style={[styles.root, mode === 'offline' && styles.offline]} accessibilityLiveRegion="polite" accessibilityRole="alert">
    <Text style={[styles.icon, mode === 'offline' && styles.iconOffline]}>{TEXT[mode].icon}</Text>
    <Text style={styles.text}>{TEXT[mode].text}</Text>
    {mode === 'offline' && showRetry ? <FocusButton testID="connection-retry" label="Retry" accessibilityLabel="Retry connecting to Inox" compact hasTVPreferredFocus onPress={onRetry} /> : null}
  </View>
));

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: space.safeY,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    borderLeftWidth: space.xs / 2,
    borderLeftColor: color.accent,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    zIndex: layer.notice,
  },
  offline: {borderLeftColor: color.warning},
  icon: {color: color.accent, fontSize: font.body, fontWeight: '700'},
  iconOffline: {color: color.warning},
  text: {color: color.text, fontSize: font.body},
});
