import React, { useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { UnifiedHeader } from './UnifiedHeader';
import { TopBar } from './TopBar';
import { routeMeta } from './navigation';
import { SIDEBAR_WIDTH, useSidebarCollapsed } from './sidebarState';
import { V2Footer } from '../v2/V2Footer';
import { useRevealSystem } from '../../lib/motion';

export const AppLayout: React.FC = () => {
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();
  const collapsed = useSidebarCollapsed();
  const main = useRef<HTMLElement>(null);
  const meta = useMemo(() => routeMeta(pathname, new URLSearchParams(search)), [pathname, search]);

  // Sections marked data-reveal rise into place as pages, stages and data appear (GSAP + ScrollTrigger).
  useRevealSystem(main);

  useEffect(() => {
    document.title = `${meta.title} – FraudShield AI`;
  }, [meta.title]);

  // A new page starts at the top; Back and Forward keep the browser's own scroll restoration.
  useEffect(() => {
    if (navigationType === 'PUSH') window.scrollTo?.({ top: 0 });
  }, [pathname, navigationType]);

  const sidebar = collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;

  return (
    <div className="min-h-screen flex flex-col text-ink" style={{ '--sidebar-w': `${sidebar}px` } as React.CSSProperties}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] btn-secondary">
        Skip to content
      </a>
      <UnifiedHeader />
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[var(--sidebar-w)] transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
        <TopBar meta={meta} />
        <main
          ref={main}
          id="main"
          tabIndex={-1}
          className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:pt-8 lg:pb-12 min-w-0 min-h-[calc(100vh-4rem)] lg:min-h-[calc(100vh-3.5rem)] outline-none"
        >
          <Outlet />
        </main>
        <V2Footer />
      </div>
    </div>
  );
};

export default AppLayout;
