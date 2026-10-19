import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Which element should take focus next, for `hasTVPreferredFocus={target === id}`.
 *
 * Vega moves focus when an element mounts with that prop or when it flips to true, so:
 * - `settle()` (call it from the elements' onFocus) clears the target once focus has landed, which
 *   keeps a later re-render or remount (a lobby refresh) from pulling focus back;
 * - `request(id)` sets a new target; asking again for the current target flips it off for one
 *   frame so the prop changes and focus still moves (restoring focus after a dialog closes).
 */
export function useFocusTarget<T extends string>(initial: T | null) {
  const [target, setTargetState] = useState<T | null>(initial);
  const current = useRef<T | null>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((t: T | null) => {
    current.current = t;
    setTargetState(t);
  }, []);

  const request = useCallback(
    (t: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (current.current !== t) {
        set(t);
        return;
      }
      set(null);
      timer.current = setTimeout(() => {
        timer.current = null;
        set(t);
      }, 0);
    },
    [set],
  );

  const settle = useCallback(() => {
    if (current.current !== null && !timer.current) set(null);
  }, [set]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {target, request, settle};
}
