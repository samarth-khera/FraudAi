import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept up to date. Without media query support (unit tests, server rendering) it returns
 * `fallback`, which defaults to the desktop layout.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    },
    [query],
  );
  const read = () => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? fallback : window.matchMedia(query).matches);
  return useSyncExternalStore(subscribe, read, () => fallback);
}
