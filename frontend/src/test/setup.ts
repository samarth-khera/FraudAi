import '@testing-library/jest-dom';

// jsdom does not implement scrolling; components call it when changing sections.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
