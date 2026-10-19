import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler} from 'react-native';
import {logger} from '../platform/logger';
import {Dialog} from './ui/Dialog';

interface Options {
  /** Runs first on Back; return true when the screen used the key itself (e.g. closed a keyboard). */
  onBack?: () => boolean;
  /** Runs after Stay or a second Back closed the prompt, so the screen can restore its focus. */
  onClosed?: () => void;
}

/**
 * Back on a top-level screen (Boot, Sign-in, Lobby) asks "Leave Inox?" instead of quitting at once
 * (tv-ux.md). Stay has default focus; Back while the prompt is open closes it. Render `dialog` as the
 * screen's last child so it covers everything.
 */
export function useExitPrompt({onBack, onClosed}: Options = {}) {
  const [open, setOpen] = useState(false);
  // The Back listener is registered once and reads the latest state and callbacks from here.
  const state = useRef({open, onBack, onClosed});
  useEffect(() => {
    state.current = {open, onBack, onClosed};
  });

  const close = useCallback(() => {
    setOpen(false);
    state.current.onClosed?.();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.current.open) {
        logger.info('exit', 'back closes the prompt');
        close();
      } else if (!state.current.onBack?.()) {
        logger.info('exit', 'prompt');
        setOpen(true);
      }
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const exit = useCallback(() => {
    logger.info('exit', 'leaving the app');
    // [U] verify on VVD. On Vega, BackHandler.exitApp() calls
    // NativeDeviceEventManager.invokeDefaultBackPressHandler() (react-native-kepler
    // Libraries/Utilities/BackHandler.kepler.js), the default the OS runs for a Back nobody handles.
    // KeplerBackHandler (useKeplerBackHandler) does the same per root tag, for multi-screen apps.
    BackHandler.exitApp();
  }, []);

  const dialog = open ? (
    <Dialog
      title="Leave Inox?"
      message="Your rooms carry on without you. Come back any time."
      defaultIndex={0}
      actions={[
        {label: 'Stay', onPress: close, variant: 'primary', testID: 'exit-stay'},
        {label: 'Exit', onPress: exit, testID: 'exit-confirm'},
      ]}
    />
  ) : null;

  return {open, dialog};
}
