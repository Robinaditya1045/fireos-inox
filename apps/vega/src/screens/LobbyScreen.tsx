import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {MediaAsset, Room} from '../../../../packages/core/src';
import {FocusButton} from '../components/FocusButton';
import {logger} from '../platform/logger';
import {api} from '../platform/services';
import {color, font, space} from '../theme/tokens';

const POLL_MS = 15_000;

// Same matching rule as Inox's web lobby (frontend/src/utils/roomActivity.ts): by media URL.
function titleFor(room: Room, media: MediaAsset[]): string | undefined {
  const url = room.activity?.media_url || room.current_media_url;
  return media.find((m) => m.hls_master_url === url || m.source_url === url)?.title;
}

export const LobbyScreen = ({username, onEnterRoom}: {username: string; onEnterRoom: (room: Room) => void}) => {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([api.listRooms(), api.listMedia()]);
      setRooms(r);
      setMedia(m);
      setError(null);
      logger.info('lobby', 'refreshed', {rooms: r.length, live: r.filter((x) => x.activity).length});
    } catch {
      setError("Can't reach Inox — retrying");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const streaming = (rooms ?? []).filter((r) => r.activity);
  const others = (rooms ?? []).filter((r) => !r.activity);

  const card = (room: Room, i: number, first: boolean) => {
    const title = titleFor(room, media);
    const a = room.activity;
    const status = a ? `${a.is_playing ? '▶ Playing' : '❚❚ Paused'} · ${a.viewers} watching` : 'Nobody here yet';
    return (
      <FocusButton
        key={room.id}
        testID={`room-${i}`}
        label={room.name}
        sublabel={title ? `${title} — ${status}` : status}
        hasTVPreferredFocus={first}
        onPress={() => onEnterRoom(room)}
        style={styles.card}
      />
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Hi {username}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rooms === null ? <Text style={styles.muted}>Loading rooms…</Text> : null}
      {rooms && rooms.length === 0 ? <Text style={styles.muted}>No rooms yet — create one in the Inox web app.</Text> : null}
      {streaming.length > 0 ? (
        <>
          <Text style={styles.heading}>Now Streaming</Text>
          <View style={styles.row}>{streaming.map((r, i) => card(r, i, i === 0))}</View>
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          <Text style={styles.heading}>All rooms</Text>
          <View style={styles.row}>{others.map((r, i) => card(r, streaming.length + i, streaming.length === 0 && i === 0))}</View>
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: color.bg},
  content: {paddingHorizontal: space.safeX, paddingVertical: space.safeY},
  greeting: {color: color.text, fontSize: font.title, fontWeight: '700', marginBottom: space.xl},
  heading: {color: color.textMuted, fontSize: font.heading, marginBottom: space.lg, marginTop: space.lg},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: space.lg},
  card: {width: 520, minHeight: 140, justifyContent: 'center'},
  muted: {color: color.textMuted, fontSize: font.body},
  error: {color: color.danger, fontSize: font.body, marginBottom: space.lg},
});
