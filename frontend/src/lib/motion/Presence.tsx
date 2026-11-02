import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMotionMode } from './env';

/**
 * AnimatePresence that steps aside when motion is off (no media queries, as in unit tests): children then mount and
 * unmount at once, so nothing waits for an exit animation that will never be seen.
 */
export const Presence: React.FC<{ children: React.ReactNode; initial?: boolean; onExitComplete?: () => void }> = ({
  children,
  initial,
  onExitComplete,
}) => {
  const mode = useMotionMode();
  if (mode === 'off') return <>{children}</>;
  return (
    <AnimatePresence initial={initial} onExitComplete={onExitComplete}>
      {children}
    </AnimatePresence>
  );
};
