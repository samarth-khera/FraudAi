import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FlaskConical } from 'lucide-react';
import type { Crumb, RouteMeta } from './navigation';

const Crumbs: React.FC<{ crumbs: Crumb[] }> = ({ crumbs }) => (
  <nav aria-label="Breadcrumb" className="min-w-0">
    <ol className="flex items-center gap-1.5 text-[13px] min-w-0">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0" aria-hidden="true" />}
            {c.to && !last ? (
              <Link to={c.to} className={`font-medium text-mute hover:text-iris-deep transition-colors truncate ${c.mono ? 'font-mono' : ''}`}>
                {c.label}
              </Link>
            ) : (
              <span aria-current={last ? 'page' : undefined} className={`font-semibold text-ink truncate ${c.mono ? 'font-mono text-[12.5px]' : ''}`}>
                {c.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

/**
 * Where you are and which data you are looking at. Sticky above the content on large screens; on small screens only
 * nested pages show their trail, under the menu bar.
 */
export const TopBar: React.FC<{ meta: RouteMeta }> = ({ meta }) => (
  <>
    <div data-print-hide className="hidden lg:block sticky top-0 z-30 border-b border-line/70 bg-[rgba(245,246,255,0.78)] backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[1360px] px-10 h-14 flex items-center justify-between gap-6">
        <Crumbs crumbs={meta.crumbs} />
        <p className="flex items-center gap-1.5 shrink-0 rounded-full border border-line bg-white/80 px-3 py-1 text-xs font-medium text-mute" title="Every account and transaction here is synthetic.">
          <FlaskConical className="w-3.5 h-3.5 text-sev-elevated" aria-hidden="true" />
          {meta.dataset ?? 'Synthetic data'}
        </p>
      </div>
    </div>
    {meta.crumbs.some((c) => c.to) && (
      <div data-print-hide className="lg:hidden px-4 sm:px-6 pt-4 -mb-2">
        <Crumbs crumbs={meta.crumbs} />
      </div>
    )}
  </>
);
