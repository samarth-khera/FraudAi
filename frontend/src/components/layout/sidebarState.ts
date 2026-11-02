import { useSyncExternalStore } from 'react';

/** Whether the desktop sidebar is folded to icons. Remembered per browser; storage may be unavailable. */
const KEY = 'fraudshield.sidebar';
const listeners = new Set<() => void>();

function initial(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'collapsed' || stored === 'expanded') return stored === 'collapsed';
  } catch {
    // Private windows and blocked storage: fall back to the width-based default.
  }
  // Without a stored choice, small laptops start folded so the content keeps its room.
  return typeof window !== 'undefined' && window.innerWidth >= 1024 && window.innerWidth < 1200;
}

let collapsed = typeof window === 'undefined' ? false : initial();

export function setSidebarCollapsed(next: boolean): void {
  collapsed = next;
  try {
    window.localStorage.setItem(KEY, next ? 'collapsed' : 'expanded');
  } catch {
    // Remembering is a convenience only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => collapsed, () => false);
}

export const SIDEBAR_WIDTH = { expanded: 264, collapsed: 76 } as const;
