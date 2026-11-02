import type { Transition, Variants } from 'framer-motion';
import { DURATION, EASE_OUT } from './env';

/**
 * Motion (framer-motion) owns component-level motion: presence of drawers, popovers and dialogs, tab indicators and
 * press feedback. GSAP owns orchestrated sequences (page reveals, the fund-trail drawing). The two never animate the
 * same element.
 *
 * Every variant pairs movement with opacity. Under MotionConfig reducedMotion="user" Motion drops the movement and keeps
 * the fade, so reduced motion still shows what appeared or disappeared.
 */

export const springSnappy: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 };
export const easeBase: Transition = { duration: DURATION.base, ease: EASE_OUT };
export const easeFast: Transition = { duration: DURATION.fast, ease: 'easeOut' };

export const drawerFromLeft: Variants = {
  hidden: { x: '-104%', opacity: 0.6 },
  shown: { x: 0, opacity: 1, transition: { duration: 0.32, ease: EASE_OUT } },
  exit: { x: '-104%', opacity: 0.6, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
};

export const drawerFromRight: Variants = {
  hidden: { x: 40, opacity: 0 },
  shown: { x: 0, opacity: 1, transition: { duration: 0.3, ease: EASE_OUT } },
  exit: { x: 28, opacity: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

export const scrim: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: easeFast },
  exit: { opacity: 0, transition: easeFast },
};

/** Popovers grow from their anchor side. */
export const popover = (from: 'up' | 'down' | 'side' = 'down'): Variants => {
  const offset = from === 'side' ? { x: -6, y: 0 } : { x: 0, y: from === 'down' ? -6 : 6 };
  return {
    hidden: { opacity: 0, scale: 0.98, ...offset },
    shown: { opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
    exit: { opacity: 0, scale: 0.98, ...offset, transition: { duration: 0.12, ease: 'easeIn' } },
  };
};

/** Content that swaps in place (a stage of an investigation, a section of a case). */
export const swap: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

/** Press feedback for prominent buttons and selectable cards. */
export const press = { whileTap: { scale: 0.97 }, transition: springSnappy } as const;

/** A card that lifts slightly under the pointer. */
export const lift = { whileHover: { y: -2 }, whileTap: { y: 0, scale: 0.995 }, transition: springSnappy } as const;
