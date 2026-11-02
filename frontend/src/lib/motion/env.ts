import { useSyncExternalStore } from 'react';

/**
 * How much motion the interface may use.
 * - full: the person has not asked for reduced motion.
 * - reduced: the operating system asks for reduced motion; movement is replaced by short fades or nothing.
 * - off: no media queries at all (server rendering, unit tests); nothing animates and nothing waits for an exit.
 */
export type MotionMode = 'full' | 'reduced' | 'off';

const QUERY = '(prefers-reduced-motion: reduce)';

export function motionMode(): MotionMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'off';
  return window.matchMedia(QUERY).matches ? 'reduced' : 'full';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

/** The current motion mode, kept up to date if the system setting changes while the page is open. */
export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribe, motionMode, () => 'off');
}

/** Shared timing so GSAP sequences and Motion components feel like one system. Seconds. */
export const DURATION = {
  /** Hover, press, small state changes. */
  fast: 0.16,
  /** Popovers, tabs, drawers. */
  base: 0.26,
  /** Section and page entrances. */
  entrance: 0.5,
  /** One connector of the fund trail drawing itself. */
  draw: 0.42,
} as const;

/** cubic-bezier(0.16, 1, 0.3, 1): fast start, long gentle settle. The same curve as --ease-out-soft in index.css. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** The GSAP name for the same feel. */
export const GSAP_EASE_OUT = 'expo.out';
