import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * A value that clears itself after `ms` (toasts, transient notices). Showing a new value restarts
 * the timer; the timer is cleared on unmount so nothing fires into an unmounted screen.
 */
export function useTimedValue<T>(ms: number): [T | null, (value: T) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setValue(null);
  }, []);

  const show = useCallback(
    (next: T) => {
      if (timer.current) clearTimeout(timer.current);
      setValue(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setValue(null);
      }, ms);
    },
    [ms],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [value, show, clear];
}
