import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Shield, Menu, X, Wrench } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useModelStatus } from '../../lib/useModelStatus';

interface NavItem {
  name: string;
  path: string;
  matches: (pathname: string) => boolean;
  secondary?: boolean;
}

const TOOL_PREFIXES = ['/tools', '/insights', '/audit', '/fund-flow', '/workspace', '/v2', '/accounts', '/app/model-insights', '/app/transaction-check', '/app/fund-flow', '/app/audit'];

export const NAV_ITEMS: NavItem[] = [
  { name: 'Home', path: '/', matches: (p) => p === '/' },
  { name: 'Investigate', path: '/investigate', matches: (p) => p.startsWith('/investigate') },
  { name: 'Investigations', path: '/cases', matches: (p) => p.startsWith('/cases') || p.startsWith('/app/cases') },
  { name: 'Tools', path: '/tools', matches: (p) => TOOL_PREFIXES.some((t) => p === t || p.startsWith(`${t}/`)), secondary: true },
];

const DOT: Record<string, string> = {
  checking: 'bg-[#8C857B] animate-pulse',
  ready: 'bg-[#22C55E]',
  unavailable: 'bg-[#F59E0B]',
  server_unreachable: 'bg-[#E11D48]',
};

const ModelStatusIndicator: React.FC = () => {
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
        className="inline-flex items-center gap-2 rounded-full border border-[#EAE3D6] bg-[#FAF7F2] px-3 py-1.5 text-xs font-semibold text-[#1A1714] hover:bg-white transition-colors cursor-pointer"
      >
        <span className={`w-2 h-2 rounded-full ${DOT[view.state]}`} aria-hidden="true" />
        <span className="hidden sm:inline">{view.label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-label="Model status details"
            className="absolute right-0 mt-2 w-72 rounded-2xl border border-[#EAE3D6] bg-white p-4 text-xs text-[#6B655B] shadow-[0_16px_36px_-8px_rgba(26,23,20,0.18)] z-50"
          >
            <p className="font-semibold text-sm text-[#1A1714]">{view.label}</p>
            <p className="mt-1 leading-relaxed">{view.detail}</p>
            <Link
              to="/tools/model"
              onClick={() => setOpen(false)}
              className="mt-3 inline-block font-semibold text-[#B45309] hover:text-[#EA8500]"
            >
              Model performance details →
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const UnifiedHeader: React.FC = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-[#EAE3D6] bg-white/95 backdrop-blur-md">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5 group shrink-0" aria-label="FraudShield AI home">
          <span className="w-9 h-9 rounded-xl bg-[#FFF4E6] border border-[#FCD5B5] flex items-center justify-center">
            <Shield className="w-5 h-5 text-[#EA8500]" aria-hidden="true" />
          </span>
          <span className="font-display font-extrabold text-base tracking-tight text-[#1A1714] group-hover:text-[#D27400] transition-colors">
            FraudShield AI
          </span>
        </Link>

        <nav aria-label="Main" className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.matches(location.pathname);
            return (
              <Link
                key={item.name}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={`relative isolate px-3.5 py-2 rounded-full text-sm font-semibold transition-colors inline-flex items-center gap-1.5 ${
                  active ? 'text-[#B45309]' : item.secondary ? 'text-[#8C857B] hover:text-[#1A1714]' : 'text-[#6B655B] hover:text-[#1A1714]'
                }`}
              >
                {item.secondary && <Wrench className="w-3.5 h-3.5" aria-hidden="true" />}
                {item.name}
                {active && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : 'nav-active'}
                    className="absolute inset-0 rounded-full bg-[#FFF4E6] border border-[#FCD5B5] -z-10"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ModelStatusIndicator />
          {/* Wrapper carries md:hidden: .btn-icon sets display and would override it on the button itself. */}
          <div className="md:hidden">
            <button
              type="button"
              className="btn-icon"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            aria-label="Main mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden overflow-hidden border-t border-[#EAE3D6] bg-white"
          >
            <div className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = item.matches(location.pathname);
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-xl px-3 py-2.5 text-sm font-semibold ${
                      active ? 'bg-[#FFF4E6] text-[#B45309]' : 'text-[#1A1714] hover:bg-[#FAF7F2]'
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
};
