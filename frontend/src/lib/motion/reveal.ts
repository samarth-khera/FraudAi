import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DURATION, GSAP_EASE_OUT, motionMode } from './env';

let registered = false;
/** ScrollTrigger is registered on first use, and only when motion is on (it reads media queries as it registers). */
function ensureScrollTrigger() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
}

/**
 * One reveal system for the whole application (GSAP + ScrollTrigger).
 *
 * Pages only mark their sections with `data-reveal`. Whenever such an element is added inside the root (a route change,
 * data arriving, a stage switching), it rises into place:
 * - at once, in document order with a short stagger, if it is on screen when it appears (the page header first, then
 *   the sections below it);
 * - otherwise the first time it is scrolled to (a ScrollTrigger that fires once).
 *
 * `data-reveal="fade"` fades without movement. Nested marked elements are left to their outermost marked ancestor.
 * Nothing is hidden when motion is reduced or unavailable, focus moving into a hidden section reveals it at once, and
 * every trigger is killed when its element leaves the page or the system stops.
 */
export function startRevealSystem(root: HTMLElement): () => void {
  if (motionMode() !== 'full') return () => {};
  ensureScrollTrigger();

  const triggers = new Map<HTMLElement, ScrollTrigger>();
  let pending: HTMLElement[] = [];
  let frame = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (els: HTMLElement[]) => {
    const live = els.filter((el) => el.isConnected);
    if (!live.length) return;
    gsap.to(live, {
      opacity: 1,
      y: 0,
      duration: DURATION.entrance,
      ease: GSAP_EASE_OUT,
      stagger: Math.min(0.06, 0.36 / live.length),
      overwrite: 'auto',
      clearProps: 'opacity,transform',
      onComplete: () => live.forEach((el) => (el.dataset.revealDone = '1')),
    });
  };

  const flush = () => {
    frame = 0;
    const batch = pending.filter((el) => el.isConnected);
    pending = [];
    const now: HTMLElement[] = [];
    const fold = window.innerHeight * 0.94;
    for (const el of batch) {
      if (el.getBoundingClientRect().top < fold) {
        now.push(el);
        continue;
      }
      triggers.set(
        el,
        ScrollTrigger.create({
          trigger: el,
          start: 'top 94%',
          once: true,
          onEnter: () => {
            triggers.delete(el);
            show([el]);
          },
        }),
      );
    }
    show(now);
  };

  const mark = (el: HTMLElement) => {
    if (el.dataset.revealSeen) return;
    el.dataset.revealSeen = '1';
    // Leave nested sections to the outer one while it is still on its way in.
    const outer = el.parentElement?.closest<HTMLElement>('[data-reveal]');
    if (outer && !outer.dataset.revealDone) return;
    gsap.set(el, { opacity: 0, y: el.dataset.reveal === 'fade' ? 0 : 14 });
    pending.push(el);
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches('[data-reveal]')) mark(node);
    node.querySelectorAll<HTMLElement>('[data-reveal]').forEach(mark);
  };

  const prune = () => {
    for (const [el, st] of triggers) {
      if (!el.isConnected) {
        st.kill();
        triggers.delete(el);
      }
    }
  };

  const observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
    prune();
    // Content above a waiting section may have grown or shrunk: recompute trigger positions once things settle.
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => triggers.size && ScrollTrigger.refresh(), 160);
  });

  const onFocusIn = (e: FocusEvent) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-reveal]');
    const st = el && triggers.get(el);
    if (el && st) {
      st.kill();
      triggers.delete(el);
      show([el]);
    }
  };

  scan(root);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('focusin', onFocusIn);

  return () => {
    observer.disconnect();
    root.removeEventListener('focusin', onFocusIn);
    cancelAnimationFrame(frame);
    clearTimeout(refreshTimer);
    triggers.forEach((st) => st.kill());
    triggers.clear();
    // Anything still hidden is shown at once, so stopping the system can never leave content invisible.
    root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => gsap.set(el, { clearProps: 'opacity,transform' }));
  };
}

/**
 * Runs the reveal system on a container for as long as it is mounted. A layout effect, so content that is already on
 * the page is hidden before the first paint and rises in, rather than flashing visible first.
 */
export function useRevealSystem(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return startRevealSystem(el);
  }, [ref]);
}
