import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {ApiError, lobbyRows, type LobbyCard, type MediaAsset, type Room} from '../../../../packages/core/src';
import {AppHeader, UserChip} from '../components/AppHeader';
import {useExitPrompt} from '../components/ExitPrompt';
import {FocusButton} from '../components/FocusButton';
import {InlineNotice} from '../components/InlineNotice';
import {RoomCard} from '../components/RoomCard';
import {SkeletonCard} from '../components/ui/Skeleton';
import {useFocusTarget} from '../components/useFocusTarget';
import {logger} from '../platform/logger';
import {api, auth} from '../platform/services';
import {color, font, size, space} from '../theme/tokens';

const POLL_MS = 15_000;
const SKELETONS = ['s1', 's2', 's3'];

// Focus targets: a room ID, or one of these controls.
const SIGN_OUT = 'sign-out';
const RETRY = 'lobby-retry';
const REFRESH = 'lobby-refresh';

type RowId = 'now' | 'all';
type LobbyData = {rooms: Room[]; media: MediaAsset[]};

/** The rooms seen last, so coming back from a room shows them at once (then refreshes). */
let lastSeen: (LobbyData & {username: string}) | null = null;

interface Props {
  username: string;
  /** The room entered last (this run or a previous one): focused first when it is listed. */
  focusRoomId: string | null;
  onEnterRoom: (room: Room) => void;
}

/**
 * Rows "Now Streaming" (occupied rooms) and "All rooms", polled every 15 s while mounted. Focus starts
 * on the last-entered room, else the first card, and stays on the same room across refreshes. Back
 * asks "Leave Inox?".
 */
export const LobbyScreen = ({username, focusRoomId, onEnterRoom}: Props) => {
  const [data, setData] = useState<LobbyData | null>(() => (lastSeen?.username === username ? {rooms: lastSeen.rooms, media: lastSeen.media} : null));
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const initialDone = useRef(false);
  /** The control that last had focus, and the row a card was in then. */
  const lastFocus = useRef<{id: string; row: RowId | null} | null>(null);
  const {target: focusId, request: requestFocus, settle: settleFocus} = useFocusTarget<string>(null);

  // Cards fill the width inside the safe area: 3 per row at 1920, 2 on VVD's 960-wide canvas.
  const {width} = useWindowDimensions();
  const inner = width - 2 * space.safeX;
  const perRow = Math.max(1, Math.min(size.lobbyCardsMax, Math.floor((inner + space.lg) / (size.lobbyCardMinWidth + space.lg))));
  const cardWidth = Math.floor((inner - (perRow - 1) * space.lg) / perRow);

  const rows = useMemo(() => (data ? lobbyRows(data.rooms, data.media) : null), [data]);
  const firstId = rows ? (rows.nowStreaming[0] ?? rows.allRooms[0])?.room.id ?? null : null;
  const shape = !rows ? (failed ? 'error' : 'loading') : firstId ? 'cards' : 'empty';

  const rowOf = useCallback(
    (id: string): RowId | null => {
      if (rows?.nowStreaming.some((c) => c.room.id === id)) return 'now';
      if (rows?.allRooms.some((c) => c.room.id === id)) return 'all';
      return null;
    },
    [rows],
  );

  const refresh = useCallback(async (why: 'first' | 'poll' | 'retry') => {
    if (inFlight.current) return; // never overlap: a slow poll just delays the next one
    inFlight.current = true;
    setLoading(true);
    try {
      // A failed media list only costs titles, so the last one is kept.
      const [rooms, mediaResult] = await Promise.all([
        api.listRooms(),
        api.listMedia().catch((err: unknown) => {
          logger.warn('lobby', 'media list failed', {status: err instanceof ApiError ? err.status : -1});
          return null;
        }),
      ]);
      if (!alive.current) return;
      const media = mediaResult ?? (lastSeen?.username === username ? lastSeen.media : []);
      lastSeen = {username, rooms, media};
      setData({rooms, media});
      setFailed(false);
      logger.info('lobby', 'refreshed', {why, rooms: rooms.length, live: rooms.filter((r) => r.activity).length});
    } catch (err) {
      if (!alive.current) return;
      // A 401 has already sent the app to Sign-in (services.onUnauthorized).
      logger.warn('lobby', 'refresh failed', {why, status: err instanceof ApiError ? err.status : -1});
      setFailed(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    alive.current = true;
    refresh('first');
    const t = setInterval(() => refresh('poll'), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const restoreFocus = useCallback(() => {
    const f = lastFocus.current;
    const present = (id: string) => id === SIGN_OUT || (id === RETRY && shape === 'error') || (id === REFRESH && shape === 'empty') || rowOf(id) !== null;
    if (f && present(f.id)) requestFocus(f.id);
    else if (firstId) requestFocus(firstId);
    else if (shape === 'error') requestFocus(RETRY);
    else if (shape === 'empty') requestFocus(REFRESH);
  }, [firstId, requestFocus, rowOf, shape]);

  const exitPrompt = useExitPrompt({onClosed: restoreFocus});
  const promptOpen = exitPrompt.open;

  // An empty or error state has exactly one action; it takes focus when it appears. Nothing takes
  // focus while the exit prompt is open: it would pull focus out of the dialog.
  useEffect(() => {
    if (promptOpen) return;
    if (shape === 'error') requestFocus(RETRY);
    if (shape === 'empty') requestFocus(REFRESH);
  }, [shape, promptOpen, requestFocus]);

  // Cards: the initial target once, then only repairs. A card that changes rows is remounted (its
  // native view, and the focus on it, are gone), so focus is asked back for the same room.
  useEffect(() => {
    if (!rows || !firstId || promptOpen) return;
    if (!initialDone.current) {
      initialDone.current = true;
      const restored = !!focusRoomId && rowOf(focusRoomId) !== null;
      logger.info('lobby', 'initial focus', {on: restored ? 'last entered room' : 'first card'});
      requestFocus(restored && focusRoomId ? focusRoomId : firstId);
      return;
    }
    const f = lastFocus.current;
    if (!f) return;
    if (f.row === null) {
      // Retry/Refresh had focus and has gone now that there are cards.
      if (f.id !== SIGN_OUT) requestFocus(firstId);
      return;
    }
    const row = rowOf(f.id);
    if (row !== f.row) {
      logger.info('lobby', 'focused room moved', {from: f.row, to: row ?? 'gone'});
      requestFocus(row ? f.id : firstId);
    }
  }, [rows, firstId, focusRoomId, rowOf, promptOpen, requestFocus]);

  const focused = (id: string, row: RowId | null) => () => {
    lastFocus.current = {id, row};
    settleFocus();
  };

  const signOut = () => {
    if (signingOut) return;
    logger.info('lobby', 'sign out');
    setSigningOut(true);
    auth.signOut(); // the App moves to Sign-in when it is done
  };

  const renderRow = (title: string, row: RowId, cards: LobbyCard[], offset: number) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.grid}>
        {cards.map((card, i) => (
          <RoomCard
            key={card.room.id}
            card={card}
            width={cardWidth}
            testID={`room-${offset + i}`}
            preferred={focusId === card.room.id}
            onFocus={focused(card.room.id, row)}
            onPress={() => onEnterRoom(card.room)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <AppHeader
          title="Rooms"
          right={
            <>
              <UserChip username={username} />
              <FocusButton
                testID={SIGN_OUT}
                label={signingOut ? 'Signing out…' : 'Sign out'}
                variant="ghost"
                compact
                hasTVPreferredFocus={focusId === SIGN_OUT}
                onFocus={focused(SIGN_OUT, null)}
                onPress={signOut}
              />
            </>
          }
        />
        {shape === 'cards' && failed ? <InlineNotice tone="warning" text="Showing the last known rooms — retrying" style={styles.stale} /> : null}
      </View>

      {rows && shape === 'cards' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {rows.nowStreaming.length > 0 ? renderRow('Now Streaming', 'now', rows.nowStreaming, 0) : null}
          {rows.allRooms.length > 0 ? renderRow('All rooms', 'all', rows.allRooms, rows.nowStreaming.length) : null}
        </ScrollView>
      ) : shape === 'loading' ? (
        <View style={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Loading rooms…</Text>
            <View style={styles.grid}>
              {SKELETONS.map((k) => (
                <SkeletonCard key={k} style={{width: cardWidth}} />
              ))}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>{shape === 'error' ? "Can't reach Inox" : 'No rooms yet — create one in the Inox web app'}</Text>
          <Text style={styles.stateBody}>{shape === 'error' ? 'Check that the TV is online and Inox is running.' : 'Rooms you can join show up here.'}</Text>
          {shape === 'error' ? (
            <FocusButton
              testID={RETRY}
              label={loading ? 'Retrying…' : 'Retry'}
              variant="primary"
              hasTVPreferredFocus={focusId === RETRY}
              onFocus={focused(RETRY, null)}
              onPress={() => refresh('retry')}
              style={styles.stateButton}
            />
          ) : (
            <FocusButton
              testID={REFRESH}
              label={loading ? 'Refreshing…' : 'Refresh'}
              variant="primary"
              hasTVPreferredFocus={focusId === REFRESH}
              onFocus={focused(REFRESH, null)}
              onPress={() => refresh('retry')}
              style={styles.stateButton}
            />
          )}
        </View>
      )}
      {exitPrompt.dialog}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: color.bg},
  header: {paddingHorizontal: space.safeX, paddingTop: space.safeY, gap: space.md},
  stale: {alignSelf: 'flex-start'},
  scroll: {flex: 1},
  content: {paddingHorizontal: space.safeX, paddingTop: space.md, paddingBottom: space.safeY, gap: space.lg},
  section: {gap: space.md},
  sectionTitle: {color: color.text, fontSize: font.body, fontWeight: '700'},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: space.lg},
  state: {flex: 1, paddingHorizontal: space.safeX, paddingBottom: space.safeY, justifyContent: 'center', alignItems: 'flex-start', gap: space.md},
  stateTitle: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  stateBody: {color: color.textMuted, fontSize: font.body},
  stateButton: {marginTop: space.md, alignItems: 'center'},
});
