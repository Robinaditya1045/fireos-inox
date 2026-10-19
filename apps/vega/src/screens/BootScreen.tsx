import React, {useCallback, useEffect, useRef, useState} from 'react';
import {PixelRatio, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {ApiError, type Session} from '../../../../packages/core/src';
import {useExitPrompt} from '../components/ExitPrompt';
import {FocusButton} from '../components/FocusButton';
import {useFocusTarget} from '../components/useFocusTarget';
import {Wordmark} from '../components/Wordmark';
import {logger} from '../platform/logger';
import {api, auth} from '../platform/services';
import {clearSession, isExpired, loadLastRoomId, loadSession} from '../platform/storage';
import {color, font, space} from '../theme/tokens';

export const SESSION_ENDED = 'Your session ended — please sign in again';

/** After this long, "Connecting…" says why it is still waiting (no unexplained wait over 1 s). */
const SLOW_MS = 4000;

export interface BootResult {
  /** A session the server accepted, or null to sign in. */
  session: Session | null;
  /** Shown on Sign-in (session ended). */
  notice?: string;
  lastRoomId: string | null;
}

/**
 * Restores the stored session (architecture §5.1): none → Sign-in; expired → Sign-in with a notice;
 * otherwise GET /users/me: 200 → Lobby, 401 → Sign-in with a notice, network error or 5xx → keep
 * the session and offer Retry.
 */
export const BootScreen = ({onDone}: {onDone: (result: BootResult) => void}) => {
  const [phase, setPhase] = useState<'connecting' | 'slow' | 'offline'>('connecting');
  const [retrying, setRetrying] = useState(false);
  const stored = useRef<{session: Session; lastRoomId: string | null} | null>(null);
  const alive = useRef(true);
  const {target: focusId, request: requestFocus, settle: settleFocus} = useFocusTarget<'retry'>(null);
  const {width, height} = useWindowDimensions();

  const exitPrompt = useExitPrompt();
  const promptOpen = exitPrompt.open;

  // Retry takes focus when it appears, and again when the exit prompt closes.
  useEffect(() => {
    if (phase === 'offline' && !promptOpen) requestFocus('retry');
  }, [phase, promptOpen, requestFocus]);

  useEffect(() => {
    // The layout canvas Vega reports (tv-ux.md [U]); VVD screenshots suggest 960×540.
    logger.info('ui', 'window', {width, height, pixelRatio: PixelRatio.get(), fontScale: PixelRatio.getFontScale()});
  }, [width, height]);

  // `run` must stay stable (its effect runs once), so the latest onDone is read through a ref.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const finish = useCallback((result: BootResult) => {
    if (alive.current) onDoneRef.current(result);
  }, []);

  const run = useCallback(async () => {
    if (!stored.current) {
      const [session, lastRoomId] = await Promise.all([loadSession(), loadLastRoomId()]);
      if (!session) {
        finish({session: null, lastRoomId});
        return;
      }
      if (isExpired(session)) {
        logger.info('boot', 'stored session expired', {expires_at: session.expires_at});
        await clearSession();
        finish({session: null, notice: SESSION_ENDED, lastRoomId});
        return;
      }
      stored.current = {session, lastRoomId};
      auth.restore(session);
    }
    const {session, lastRoomId} = stored.current;
    try {
      const me = await api.me();
      logger.info('boot', 'session accepted', {user: me.username});
      // The username may have changed on the web since the session was stored.
      const current = me.username === session.username ? session : {...session, username: me.username};
      if (current !== session) auth.set(current);
      finish({session: current, lastRoomId});
    } catch (err) {
      const status = err instanceof ApiError ? err.status : -1;
      if (status === 401) {
        logger.info('boot', 'stored session rejected');
        auth.set(null);
        finish({session: null, notice: SESSION_ENDED, lastRoomId});
        return;
      }
      // Network down, timeout or a server error: the session may still be good, so keep it.
      logger.warn('boot', "can't reach Inox", {status});
      if (!alive.current) return;
      setPhase('offline');
      setRetrying(false);
    }
  }, [finish]);

  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);

  useEffect(() => {
    if (phase !== 'connecting') return;
    const t = setTimeout(() => setPhase('slow'), SLOW_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const retry = () => {
    if (retrying) return;
    logger.info('boot', 'retry');
    setRetrying(true);
    run();
  };

  return (
    <View style={styles.root}>
      <Wordmark />
      {phase === 'offline' ? (
        <View style={styles.block}>
          <Text style={styles.title} accessibilityRole="alert">
            Can't reach Inox
          </Text>
          <Text style={styles.body}>Check that the TV is online and Inox is running, then try again.</Text>
          <FocusButton
            testID="boot-retry"
            label={retrying ? 'Retrying…' : 'Retry'}
            variant="primary"
            hasTVPreferredFocus={focusId === 'retry'}
            onFocus={settleFocus}
            onPress={retry}
            style={styles.button}
          />
        </View>
      ) : (
        <View style={styles.block} accessibilityLiveRegion="polite">
          <Text style={styles.status}>Connecting…</Text>
          {phase === 'slow' ? <Text style={styles.body}>Still trying to reach Inox. This can take a few seconds.</Text> : null}
        </View>
      )}
      {exitPrompt.dialog}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: color.bg, paddingHorizontal: space.safeX, paddingVertical: space.safeY, alignItems: 'center', justifyContent: 'center', gap: space.xl},
  block: {alignItems: 'center', gap: space.md},
  title: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  status: {color: color.text, fontSize: font.body},
  body: {color: color.textMuted, fontSize: font.body, textAlign: 'center'},
  button: {marginTop: space.md, minWidth: space.xxl * 5, alignItems: 'center'},
});
