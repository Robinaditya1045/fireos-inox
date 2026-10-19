// 10-foot design tokens (docs/dev/tv-ux.md). Every UI value comes from here.
export const color = {
  bg: '#0f1115',
  surface: '#171a21',
  surfaceRaised: '#1f232c',
  /** Fill of a focused card or key. */
  surfaceHigh: '#2a2f3a',
  border: '#2c313c',
  text: '#f2f3f5',
  textMuted: '#a3a9b5',
  accent: '#7c5cff',
  /** Fill behind white text (primary buttons): 4.98:1 with onAccent, where `accent` is 4.35:1. */
  accentStrong: '#7052f5',
  accentSoft: 'rgba(124,92,255,0.22)',
  onAccent: '#ffffff',
  danger: '#ff5c7a',
  dangerSoft: 'rgba(255,92,122,0.18)',
  success: '#3ccf91',
  successSoft: 'rgba(60,207,145,0.18)',
  warning: '#ffb547',
  warningSoft: 'rgba(255,181,71,0.18)',
  overlay: 'rgba(15,17,21,0.78)',
  /** Dims the screen behind a dialog. */
  scrim: 'rgba(0,0,0,0.66)',
};

/** Chat author names: distinct hues that keep ≥ 4.5:1 on `surface` and `overlay`. */
export const authorColors = ['#9db8ff', '#ffc46b', '#5fdca7', '#ff9cb5', '#7fdde6', '#cdb2ff'] as const;

/**
 * The sizes below are written in px @1080p (tv-ux.md), but Vega lays the app out on a 960×540
 * logical canvas at pixelRatio 2 (VVD boot log `[ui] window`, 2026-10-20), so they rendered at
 * twice the intended size. Exactly half would put captions at 11 units, too small in a demo video
 * captured from the 960×540 VVD window, so type, spacing and fixed sizes use 0.7 (body text is
 * 36 physical px on a 1080p TV); the overscan-safe margin is an exact 5 %.
 */
const UI_SCALE = 0.7;
function scaled<T extends Record<string, number>>(px: T): T {
  return Object.fromEntries(Object.entries(px).map(([k, v]) => [k, Math.round(v * UI_SCALE)])) as T;
}

/** `reaction`: a floating Couch Reaction and the reaction tray keys (D17). */
export const font = scaled({display: 56, title: 40, heading: 32, body: 26, caption: 22, reaction: 72});
export const space = {...scaled({xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48}), safeX: 48, safeY: 27};
export const radius = {...scaled({sm: 8, md: 12, lg: 16}), pill: 999};
export const focus = {borderWidth: 3, scale: 1.06};
/** Room overlays (D17): control bar and reaction tray hide after that long without a key; chat bubbles and floating reactions live that long. */
export const motion = {fast: 150, standard: 250, toastMs: 3000, bannerHideMs: 4000, controlsHideMs: 6000, trayHideMs: 5000, bubbleMs: 6000, reactionFloatMs: 2500};
/** Stacking order of the room's layers over the video surface. */
export const layer = {video: 0, banner: 2, overlay: 3, panel: 4, notice: 5, toast: 6, dialog: 10};
/** Fixed sizes (px @1080p, scaled like the rest). Layouts take the window width from useWindowDimensions. */
export const size = {
  hairline: 1,
  lobbyCardsMax: 3,
  ...scaled({lobbyCardMinWidth: 340, formMaxWidth: 720, chipMaxWidth: 320, dialogWidth: 760, dialogActionMinWidth: 220, keyHeight: 52, keyHeightCompact: 40, fieldMinHeight: 96, fieldMinHeightCompact: 52, dot: 10}),
};
