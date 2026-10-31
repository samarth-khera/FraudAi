import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Calculator,
  FileSearch,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Menu,
  ScanSearch,
  Shield,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useModelStatus } from '../../lib/useModelStatus';

interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  hint: string;
  matches: (pathname: string) => boolean;
}

const starts = (p: string, prefixes: string[]) => prefixes.some((t) => p === t || p.startsWith(`${t}/`));

/** The work an investigator does, in the order they usually do it. */
export const NAV_ITEMS: NavItem[] = [
  { name: 'Overview', path: '/', icon: LayoutDashboard, hint: 'Ledger and model status', matches: (p) => p === '/' },
  { name: 'Investigate', path: '/investigate', icon: ScanSearch, hint: 'Follow an account’s money', matches: (p) => p.startsWith('/investigate') },
  { name: 'Accounts', path: '/tools/accounts', icon: Users, hint: 'Look up any ledger account', matches: (p) => starts(p, ['/tools/accounts', '/accounts', '/v2', '/workspace']) },
  { name: 'Cases', path: '/cases', icon: FolderOpen, hint: 'Saved cases and review history', matches: (p) => starts(p, ['/cases', '/app/cases']) },
];

/** Technical views for checking the models and raw records; not needed to work a case. */
export const REFERENCE_ITEMS: NavItem[] = [
  { name: 'Fund-flow explorer', path: '/tools/fund-flow', icon: GitBranch, hint: 'Trace any account with custom filters', matches: (p) => starts(p, ['/tools/fund-flow', '/fund-flow', '/app/fund-flow']) },
  { name: 'Model performance', path: '/tools/model', icon: BarChart3, hint: 'How the models were tested', matches: (p) => starts(p, ['/tools/model', '/insights', '/app/model-insights']) },
  { name: 'Audit log', path: '/tools/audit', icon: FileSearch, hint: 'Every recorded event', matches: (p) => starts(p, ['/tools/audit', '/audit', '/app/audit']) },
  { name: 'Transaction model check', path: '/tools/transaction-model', icon: Calculator, hint: 'Score one PaySim transaction', matches: (p) => starts(p, ['/tools/transaction-model', '/app/transaction-check']) },
];

const DOT: Record<string, string> = {
  checking: 'bg-faint animate-pulse',
  ready: 'bg-[#16A34A]',
  unavailable: 'bg-[#D97706]',
  server_unreachable: 'bg-sev-critical',
};

const ModelStatusIndicator: React.FC<{ placement?: 'up' | 'down' }> = ({ placement = 'down' }) => {
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Account model status: ${view.label}`}
        className="inline-flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-iris-line transition-colors cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[view.state]}`} aria-hidden="true" />
        <span className="truncate">{view.label}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Model status details"
          className={`rise-in absolute z-50 w-72 rounded-2xl border border-line bg-white p-4 text-xs text-mute shadow-[var(--shadow-lift)] ${
            placement === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 right-0'
          }`}
        >
          <p className="font-semibold text-sm text-ink">{view.label}</p>
          <p className="mt-1 leading-relaxed">{view.detail}</p>
          <Link to="/tools/model" onClick={() => setOpen(false)} className="mt-3 inline-block font-semibold text-iris-deep hover:text-iris">
            Model performance details
          </Link>
        </div>
      )}
    </div>
  );
};

const Brand: React.FC = () => (
  <Link to="/" className="flex items-center gap-2.5 group" aria-label="FraudShield AI home">
    <span className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-iris to-ice shadow-[0_6px_16px_-6px_rgba(98,70,234,0.6)]">
      <Shield className="w-[18px] h-[18px] text-white" aria-hidden="true" />
    </span>
    <span className="leading-tight">
      <span className="block font-display font-bold text-[15px] text-ink tracking-tight">FraudShield</span>
      <span className="block text-[11px] font-medium text-faint">Financial investigations</span>
    </span>
  </Link>
);

const NavLinks: React.FC<{ items: NavItem[]; pathname: string; label: string; compact?: boolean }> = ({ items, pathname, label, compact }) => (
  <ul className="space-y-0.5" aria-label={label}>
    {items.map((item) => {
      const active = item.matches(pathname);
      const Icon = item.icon;
      return (
        <li key={item.path}>
          <Link
            to={item.path}
            aria-current={active ? 'page' : undefined}
            title={item.hint}
            className={`group flex items-center gap-3 rounded-xl px-3 ${compact ? 'py-1.5 text-[13px]' : 'py-2 text-sm'} font-semibold transition-colors ${
              active ? 'bg-white text-ink shadow-[var(--shadow-float)] ring-1 ring-line' : 'text-mute hover:text-ink hover:bg-white/70'
            }`}
          >
            <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-iris' : 'text-faint group-hover:text-mute'}`} aria-hidden="true" />
            <span className="truncate">{item.name}</span>
          </Link>
        </li>
      );
    })}
  </ul>
);

/** Left sidebar on large screens; a top bar with a slide-down menu below that. */
export const UnifiedHeader: React.FC = () => {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[248px] flex-col border-r border-line/80 bg-[rgba(246,246,252,0.82)] backdrop-blur-xl px-4 py-5">
        <Brand />
        <nav aria-label="Main" className="mt-8">
          <NavLinks items={NAV_ITEMS} pathname={pathname} label="Workspace" />
        </nav>
        <nav aria-label="Reference" className="mt-8">
          <p className="px-3 mb-2 text-xs font-semibold text-faint">Reference</p>
          <NavLinks items={REFERENCE_ITEMS} pathname={pathname} label="Reference tools" compact />
        </nav>
        <div className="mt-auto space-y-3">
          <ModelStatusIndicator placement="up" />
          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Synthetic demo ledger. No real customers or bank records.
          </p>
        </div>
      </aside>

      <header className="lg:hidden sticky top-0 z-40 border-b border-line/80 bg-[rgba(246,246,252,0.9)] backdrop-blur-xl">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Brand />
          <div className="flex items-center gap-2">
            <div className="hidden sm:block w-48">
              <ModelStatusIndicator />
            </div>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div id="mobile-nav" className="rise-in border-t border-line bg-canvas px-4 py-4 space-y-5 max-h-[calc(100vh-4rem)] overflow-y-auto">
            <nav aria-label="Main mobile">
              <NavLinks items={NAV_ITEMS} pathname={pathname} label="Workspace" />
            </nav>
            <nav aria-label="Reference mobile">
              <p className="px-3 mb-2 text-xs font-semibold text-faint">Reference</p>
              <NavLinks items={REFERENCE_ITEMS} pathname={pathname} label="Reference tools" compact />
            </nav>
            <div className="sm:hidden">
              <ModelStatusIndicator />
            </div>
          </div>
        )}
      </header>
    </>
  );
};
