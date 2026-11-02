import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { motionMode } from '../../lib/motion';

const PATHS = [
  'M20 200 C 140 200, 150 90, 270 90 S 380 40, 450 40',
  'M270 90 C 330 90, 340 150, 450 150',
  'M150 140 C 220 160, 230 230, 450 230',
];
const STOPS: [number, number][] = [
  [270, 90],
  [450, 40],
  [450, 150],
  [450, 230],
];

/**
 * Faint lines of money branching from one account to several: the subject of the product, drawn once behind the
 * place where an investigation starts. Decorative only (hidden from assistive technology); static under reduced motion.
 */
export const FlowMotif: React.FC<{ className?: string }> = ({ className = '' }) => {
  const svg = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    if (motionMode() !== 'full' || !svg.current) return;
    const ctx = gsap.context(() => {
      const paths = gsap.utils.toArray<SVGPathElement>('path');
      paths.forEach((p) => {
        const len = p.getTotalLength?.() ?? 600;
        gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
      });
      gsap
        .timeline({ delay: 0.25, defaults: { ease: 'power2.inOut' } })
        .to(paths, { strokeDashoffset: 0, duration: 1.3, stagger: 0.22 })
        .from('circle', { scale: 0, transformOrigin: '50% 50%', duration: 0.4, stagger: 0.08, ease: 'back.out(2)' }, '-=0.7');
    }, svg);
    return () => ctx.revert();
  }, []);

  return (
    <svg ref={svg} className={`pointer-events-none ${className}`} viewBox="0 0 460 260" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="flow-motif" x1="0" x2="1">
          <stop offset="0" stopColor="#6558E8" stopOpacity="0" />
          <stop offset="0.45" stopColor="#6558E8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#4385F5" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {PATHS.map((d, i) => (
        <path key={d} d={d} fill="none" stroke="url(#flow-motif)" strokeWidth={i === 2 ? 1.5 : 2} opacity={i === 2 ? 0.6 : 1} strokeLinecap="round" />
      ))}
      {STOPS.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" fill="#fff" stroke="#6558E8" strokeWidth="1.5" />
      ))}
    </svg>
  );
};
