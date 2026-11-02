import '@testing-library/jest-dom';
import { MotionGlobalConfig } from 'framer-motion';

// jsdom does not implement scrolling; components call it when changing sections.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Motion components render their end state at once in tests; nothing waits for an animation frame.
MotionGlobalConfig.skipAnimations = true;
