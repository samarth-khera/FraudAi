import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, FlaskConical, Menu, Shield, X } from 'lucide-react';
import { useModelStatus } from '../../lib/useModelStatus';
import { Presence, drawerFromLeft, popover, scrim, springSnappy } from '../../lib/motion';
import { NAV_ITEMS, REFERENCE_ITEMS, type NavItem } from './navigation';
import { SIDEBAR_WIDTH, setSidebarCollapsed, useSidebarCollapsed } from './sidebarState';

export { NAV_ITEMS, REFERENCE_ITEMS } from './navigation';

const DOT: Record<string, string> = {
  checking: 'bg-faint pulse-soft',
  ready: 'bg-ok-fill shadow-[0_0_0_3px_rgba(31,157,87,0.16)]',
  unavailable: 'bg-warn-fill shadow-[0_0_0_3px_rgba(217,139,11,0.18)]',
  server_unreachable: 'bg-danger-fill shadow-[0_0_0_3px_rgba(220,47,85,0.16)]',
};

/** Model readiness, with the server's own explanation one click away. */
const ModelStatusIndicator: React.FC<{ placement?: 'up' | 'down' | 'side'; compact?: boolean }> = ({ placement = 'down', compact = false }) => {
  const view = useModelStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const where =
    placement === 'up' ? 'bottom-full mb-2 left-0' : placement === 'side' ? 'left-full ml-3 bottom-0' : 'top-full mt-2 right-0';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Model status: ${view.label}`}
        title={compact ? view.label : undefined}
        className={`inline-flex items-center gap-2.5 rounded-xl border border-line bg-white/85 text-xs font-semibold text-ink shadow-[var(--shadow-xs)] transition-colors hover:border-iris-line hover:bg-white cursor-pointer ${
          compact ? 'w-11 h-11 justify-center' : 'w-full px-3 py-2.5'
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[view.state]}`} aria-hidden="true" />
        {!compact && <span className="truncate">{view.label}</span>}
      </button>
      <Presence>
        {open && (
          <motion.div
            key="model-status"
            role="dialog"
            aria-label="Model status details"
            variants={popover(placement === 'up' ? 'up' : placement === 'side' ? 'side' : 'down')}
            initial="hidden"
            animate="shown"
            exit="exit"
            className={`absolute z-50 w-[19rem] rounded-2xl border border-line bg-white p-4 text-xs text-mute shadow-[var(--shadow-pop)] ${where}`}
          >
            <p className="flex items-center gap-2 font-semibold text-sm text-ink">
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[view.state]}`} aria-hidden="true" />
              {view.label}
            </p>
            <p className="mt-1.5 leading-relaxed">{view.detail}</p>
            <Link to="/tools/model" onClick={() => setOpen(false)} className="mt-3 inline-block font-semibold text-iris-deep hover:text-iris">
              Model performance details
            </Link>
          </motion.div>
        )}
      </Presence>
    </div>
  );
};

const BrandMark: React.FC = () => (
  <span className="relative w-9 h-9 rounded-[11px] flex items-center justify-center bg-gradient-to-br from-iris to-ice shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_8px_18px_-8px_rgba(101,88,232,0.75)] shrink-0">
    <Shield className="w-[18px] h-[18px] text-white" strokeWidth={2.2} aria-hidden="true" />
  </span>
);

const Brand: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <Link to="/" className="flex items-center gap-3 rounded-xl" aria-label="FraudShield AI home">
    <BrandMark />
    {!compact && (
      <span className="leading-tight min-w-0">
        <span className="block font-display font-bold text-[15px] text-ink tracking-tight">FraudShield AI</span>
        <span className="block text-[11.5px] font-medium text-faint">Financial investigations</span>
      </span>
    )}
  </Link>
);

/**
 * One navigation list. The active item sits on a white plate with a short violet-to-blue bar (the product's "money in
 * motion" colour marks where you are); both slide to the new item when the page changes.
 */
const NavLinks: React.FC<{ items: NavItem[]; pathname: string; label: string; surface: string; compact?: boolean; dense?: boolean }> = ({
  items,
  pathname,
  label,
  surface,
  compact = false,
  dense = false,
}) => (
  <ul className="space-y-0.5" aria-label={label}>
    {items.map((item) => {
      const active = item.matches(pathname);
      const Icon = item.icon;
      return (
        <li key={item.path}>
          <Link
            to={item.path}
            aria-current={active ? 'page' : undefined}
            title={compact ? undefined : item.hint}
            className={`group relative isolate flex items-center rounded-xl font-semibold transition-colors duration-150 ${
              compact ? 'justify-center w-11 h-10 mx-auto' : `gap-3 px-3 ${dense ? 'py-[7px] text-[13px]' : 'py-2 text-sm'}`
            } ${active ? 'text-ink' : 'text-mute hover:text-ink hover:bg-white/65'}`}
          >
            {active && (
              <>
                <motion.span
                  layoutId={`${surface}-plate`}
                  transition={springSnappy}
                  className="absolute inset-0 -z-10 rounded-xl bg-white shadow-[var(--shadow-float)] ring-1 ring-line"
                  aria-hidden="true"
                />
                <motion.span
                  layoutId={`${surface}-bar`}
                  transition={springSnappy}
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-iris to-ice"
                  aria-hidden="true"
                />
              </>
            )}
            <Icon
              className={`w-[18px] h-[18px] shrink-0 transition-colors ${active ? 'text-iris' : 'text-faint group-hover:text-mute'}`}
              strokeWidth={active ? 2.2 : 1.9}
              aria-hidden="true"
            />
            <span
              className={
                compact
                  ? 'pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-[var(--shadow-pop)] transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100'
                  : 'truncate'
              }
            >
              {item.name}
            </span>
          </Link>
        </li>
      );
    })}
  </ul>
);

const GroupLabel: React.FC<{ children: React.ReactNode; compact?: boolean }> = ({ children, compact }) =>
  compact ? (
    <span className="block mx-auto mb-2 h-px w-7 bg-line-strong" aria-hidden="true" />
  ) : (
    <p className="px-3 mb-1.5 text-xs font-semibold text-faint">{children}</p>
  );

/** The small-screen menu: a drawer over a dimmed page. Focus stays inside it until it closes. */
const MobileDrawer: React.FC<{ pathname: string; onClose: () => void }> = ({ pathname, onClose }) => {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="lg:hidden fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <motion.div variants={scrim} initial="hidden" animate="shown" exit="exit" className="absolute inset-0 bg-[rgba(23,24,43,0.32)] backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={panel}
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        variants={drawerFromLeft}
        initial="hidden"
        animate="shown"
        exit="exit"
        className="absolute inset-y-0 left-0 w-[min(320px,86vw)] bg-canvas border-r border-line shadow-[var(--shadow-pop)] flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 px-4 h-16 border-b border-line/80">
          <Brand />
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close menu" data-autofocus>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
          <nav aria-label="Main mobile">
            <GroupLabel>Workspace</GroupLabel>
            <NavLinks items={NAV_ITEMS} pathname={pathname} label="Workspace" surface="mobile" />
          </nav>
          <nav aria-label="Reference mobile">
            <GroupLabel>Reference</GroupLabel>
            <NavLinks items={REFERENCE_ITEMS} pathname={pathname} label="Reference tools" surface="mobile" dense />
          </nav>
        </div>
        <div className="px-4 pb-5 pt-3 border-t border-line/80 space-y-3">
          <ModelStatusIndicator placement="up" />
          <p className="flex gap-2 text-[11.5px] leading-relaxed text-faint">
            <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Synthetic demo data. No real customers or bank records.
          </p>
        </div>
      </motion.div>
    </div>
  );
};

/**
              * The application chrome: a left sidebar on large screens (foldable to icons, remembered per browser) and, below that,
              * a top bar whose menu opens a drawer.
              */
export const UnifiedHeader: React.FC = () => {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const collapsed = useSidebarCollapsed();
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButton.current?.focus();
  }, []);

  return (
    <>
      <aside
        data-print-hide
        id="app-sidebar"
        aria-label="Sidebar"
        style={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
        className="hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col border-r border-line bg-[rgba(238,241,254,0.72)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className={`flex items-center h-16 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <Brand compact={collapsed} />
        </div>
        <div className={`flex-1 flex flex-col pt-4 ${collapsed ? 'px-2' : 'px-3'}`}>
          <nav aria-label="Main">
            <GroupLabel compact={collapsed}>Workspace</GroupLabel>
            <NavLinks items={NAV_ITEMS} pathname={pathname} label="Workspace" surface="desktop" compact={collapsed} />
          </nav>
          <nav aria-label="Reference" className="mt-7">
            <GroupLabel compact={collapsed}>Reference</GroupLabel>
            <NavLinks items={REFERENCE_ITEMS} pathname={pathname} label="Reference tools" surface="desktop" compact={collapsed} dense />
          </nav>
          <div className={`mt-auto pb-4 space-y-3 ${collapsed ? 'flex flex-col items-center' : ''}`}>
            <ModelStatusIndicator placement={collapsed ? 'side' : 'up'} compact={collapsed} />
            {!collapsed && (
              <p className="flex gap-2 px-1 text-[11.5px] leading-relaxed text-faint">
                <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                Synthetic demo data. No real customers or bank records.
              </p>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : undefined}
              className={`flex items-center gap-2 rounded-xl text-xs font-semibold text-faint hover:text-ink hover:bg-white/65 transition-colors ${
                collapsed ? 'w-11 h-10 justify-center' : 'w-full px-3 py-2'
              }`}
            >
              {collapsed ? <ChevronsRight className="w-4 h-4" aria-hidden="true" /> : <ChevronsLeft className="w-4 h-4" aria-hidden="true" />}
              {!collapsed && 'Collapse'}
            </button>
          </div>
        </div>
      </aside>

      <header data-print-hide className="lg:hidden sticky top-0 z-40 border-b border-line/80 bg-[rgba(245,246,255,0.86)] backdrop-blur-xl">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Brand />
          <div className="flex items-center gap-2">
            <div className="hidden sm:block w-48">
              <ModelStatusIndicator />
            </div>
            <button
              ref={menuButton}
              type="button"
              className="btn-icon"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <Presence>{menuOpen && <MobileDrawer key="drawer" pathname={pathname} onClose={closeMenu} />}</Presence>
    </>
  );
};
