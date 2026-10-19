import {useEffect, useRef} from 'react';

/**
 * Calls `onIdle` once `ms` pass without `wakeKey` changing. RoomScreen bumps its key counter on
 * every remote key, so an overlay that uses this hides after that long without a key press.
 */
export function useIdleTimeout(ms: number, wakeKey: number, onIdle: () => void): void {
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  }, [onIdle]);
  useEffect(() => {
    const t = setTimeout(() => callback.current(), ms);
    return () => clearTimeout(t);
  }, [ms, wakeKey]);
}
