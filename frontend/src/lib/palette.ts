/**
 * The design tokens from index.css, as literal colours for libraries that cannot read CSS variables (Recharts,
 * Cytoscape, SVG gradient stops). Keep these in step with the @theme block in index.css.
 */
export const palette = {
  canvas: '#F5F6FF',
  panel: '#FFFFFF',
  well: '#F7F8FD',
  line: '#E5E7F2',
  lineStrong: '#D5D9E8',
  ink: '#17182B',
  inkSoft: '#34374E',
  mute: '#575E7D',
  faint: '#646A88',
  iris: '#6558E8',
  irisDeep: '#4B3DD0',
  irisSoft: '#EEEBFF',
  irisLine: '#D8D1FF',
  ice: '#4385F5',
  iceDeep: '#1F5FCF',
  iceSoft: '#E8F1FF',
  ok: '#157A42',
  okFill: '#1F9D57',
  warn: '#8F5806',
  warnFill: '#D98B0B',
  danger: '#B3163F',
  dangerFill: '#DC2F55',
  /** A connector or mark that is present but not the focus. */
  quiet: '#C9CDDF',
} as const;

/** Money movement: what came in is blue, what went out is violet. Neutral by design: neither direction is "good". */
export const flowColors = {
  incoming: palette.ice,
  incomingStrong: palette.iceDeep,
  outgoing: palette.iris,
  outgoingStrong: palette.irisDeep,
} as const;

/** Shared Recharts axis and grid styling. */
export const chartAxis = {
  tick: { fontSize: 11, fill: palette.mute },
  axisLine: { stroke: palette.line },
  grid: palette.well,
} as const;
