import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {color, font, layer, radius, size, space} from '../../theme/tokens';
import {FocusButton, type FocusButtonVariant} from '../FocusButton';

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: FocusButtonVariant;
  testID?: string;
}

/**
 * A modal confirm over the whole screen. Focus is trapped inside (TVFocusGuideView trapFocus*) and
 * starts on `defaultIndex`, which should be the safe choice. The screen's back handler is
 * responsible for closing it.
 */
export const Dialog = ({title, message, actions, defaultIndex = 0}: {title: string; message?: string; actions: DialogAction[]; defaultIndex?: number}) => (
  <View style={styles.scrim}>
    <TVFocusGuideView style={styles.card} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.actions}>
        {actions.map((a, i) => (
          <FocusButton key={a.label} testID={a.testID} label={a.label} variant={a.variant} onPress={a.onPress} hasTVPreferredFocus={i === defaultIndex} style={styles.action} />
        ))}
      </View>
    </TVFocusGuideView>
  </View>
);

const styles = StyleSheet.create({
  scrim: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center', zIndex: layer.dialog},
  card: {width: size.dialogWidth, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xxl, gap: space.lg},
  title: {color: color.text, fontSize: font.title, fontWeight: '700'},
  message: {color: color.textMuted, fontSize: font.body},
  actions: {flexDirection: 'row', gap: space.lg, marginTop: space.md},
  action: {minWidth: size.dialogActionMinWidth, alignItems: 'center'},
});
