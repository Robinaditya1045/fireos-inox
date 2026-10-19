import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {checkCustomUrl, formatDuration, libraryEntries, maxResolution, playUrl, titleFromUrl, type MediaAsset} from '../../../../packages/core/src';
import {logger} from '../platform/logger';
import {api} from '../platform/services';
import {color, font, space} from '../theme/tokens';
import {FocusButton} from './FocusButton';
import {UrlKeyboard} from './UrlKeyboard';

interface Props {
  /** The room's current media URL, marked "Now playing" and focused first. */
  currentUrl: string;
  onChoose: (url: string, title: string) => void;
}

type Tab = 'uploads' | 'url';

const URL_ERRORS = {
  empty: 'Type a video link first',
  invalid: 'Links start with http:// or https:// and have no spaces',
  live: "Live channels aren't available on TV yet",
  insecure: 'The TV plays video files only from https:// links',
} as const;

/** Kept for the app's lifetime, so a typo can be fixed and a link replayed without retyping it. */
const remembered: {tab: Tab; url: string} = {tab: 'uploads', url: ''};

/**
 * The room's media picker (Inox's MediaLibraryPicker): the Uploads tab lists ready uploads, fetched
 * each time the panel opens; the Custom URL tab plays any direct link (MP4, MKV, WebM, HLS) typed
 * with the D-pad. Back closes it (RoomScreen).
 */
export const LibraryPanel = ({currentUrl, onChoose}: Props) => {
  const [tab, setTabState] = useState<Tab>(remembered.tab);
  const [url, setUrlState] = useState(remembered.url);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setTab = (t: Tab) => {
    remembered.tab = t;
    setTabState(t);
  };
  const setUrl = (u: string) => {
    remembered.url = u;
    setUrlState(u);
    setUrlError(null);
  };

  const load = useCallback(async () => {
    setError(null);
    setAssets(null);
    try {
      const list = libraryEntries(await api.listMedia());
      setAssets(list);
      logger.info('library', 'loaded', {count: list.length});
    } catch (err) {
      logger.warn('library', 'load failed', {err: String(err)});
      setError("Couldn't load the library");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitUrl = () => {
    const check = checkCustomUrl(url);
    if (!check.ok) {
      logger.info('library', 'custom url refused', {reason: check.reason});
      setUrlError(URL_ERRORS[check.reason]);
      return;
    }
    onChoose(check.url, titleFromUrl(check.url));
  };

  const focusIndex = Math.max(0, assets?.findIndex((a) => playUrl(a) === currentUrl) ?? 0);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Media Library</Text>
      <Text style={styles.subtitle}>Choose what the whole room watches next.</Text>
      <View style={styles.tabs}>
        <FocusButton testID="library-tab-uploads" label={tab === 'uploads' ? '● Uploads' : 'Uploads'} onPress={() => setTab('uploads')} style={styles.tab} />
        <FocusButton testID="library-tab-url" label={tab === 'url' ? '● Custom URL' : 'Custom URL'} onPress={() => setTab('url')} style={styles.tab} />
      </View>
      {tab === 'url' ? (
        <UrlKeyboard value={url} onChange={setUrl} onSubmit={submitUrl} error={urlError} />
      ) : error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <FocusButton testID="library-retry" label="Try again" onPress={() => void load()} hasTVPreferredFocus />
        </>
      ) : assets === null ? (
        <Text style={styles.muted}>Loading library…</Text>
      ) : assets.length === 0 ? (
        <Text style={styles.muted}>No uploads yet — add videos in the Inox admin portal, or play a link under Custom URL.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {assets.map((a, i) => {
            const playing = playUrl(a) === currentUrl;
            // Like Inox, a duration is shown only when the server knows it.
            const duration = a.duration_seconds > 0 ? formatDuration(a.duration_seconds) : null;
            const meta = [maxResolution(a), duration, playing ? '▶ Now playing' : null].filter(Boolean).join(' · ');
            return (
              <FocusButton
                key={a.id}
                testID={`library-${i}`}
                label={a.title}
                sublabel={meta || undefined}
                hasTVPreferredFocus={i === focusIndex}
                onPress={() => onChoose(playUrl(a), a.title)}
                style={styles.item}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {position: 'absolute', top: 0, left: 0, bottom: 0, width: '40%', backgroundColor: color.bg, paddingHorizontal: space.xl, paddingVertical: space.safeY, zIndex: 4},
  title: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  subtitle: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs, marginBottom: space.lg},
  tabs: {flexDirection: 'row', gap: space.md, marginBottom: space.lg},
  tab: {paddingVertical: space.sm, paddingHorizontal: space.lg},
  list: {gap: space.md, paddingVertical: space.sm},
  item: {marginHorizontal: space.sm},
  muted: {color: color.textMuted, fontSize: font.body},
  error: {color: color.danger, fontSize: font.body, marginBottom: space.lg},
});
