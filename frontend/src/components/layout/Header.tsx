import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Menu, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

interface HeaderProps {
  onOpenMobileMenu?: () => void;
  title?: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu, title }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    api
      .getHealth()
      .then(() => {
        if (mounted) setBackendStatus('online');
      })
      .catch(() => {
        if (mounted) setBackendStatus('offline');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toUpperCase();
    if (!query) return;

    if (query.startsWith('FS-')) {
      navigate(`/app/cases/${encodeURIComponent(query)}`);
    } else {
      navigate(`/app/cases?search=${encodeURIComponent(query)}`);
    }
  };

  return (
    <header className="sticky top-0 z-30 h-16 glass-card border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
        {title && <h1 className="text-lg font-bold text-slate-900 tracking-tight hidden sm:block">{title}</h1>}
      </div>

      {/* Global Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md mx-auto hidden md:block">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search case ID (e.g. FS-1042), account, or TX..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-slate-100/90 hover:bg-slate-100 focus:bg-white border border-slate-200/80 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-900 placeholder:text-slate-600 transition-all outline-none"
          />
        </div>
      </form>

      {/* Right User & System Controls */}
      <div className="flex items-center gap-3">
        {/* Backend Connectivity Status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-white/70 shadow-2xs">
          {backendStatus === 'online' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-700 hidden sm:inline">Backend API Live</span>
            </>
          ) : backendStatus === 'offline' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
              <span className="text-rose-600 hidden sm:inline">Backend Offline</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
              <span className="text-slate-500 hidden sm:inline">Connecting...</span>
            </>
          )}
        </div>

        {/* Notifications */}
        <button
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 transition-colors relative"
          aria-label="Notifications"
          title="Demo Alerts"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
        </button>

        {/* User Profile */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
            RS
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-xs font-semibold text-slate-800 leading-tight">Rahul Sharma</div>
            <div className="text-[10px] text-slate-500">Fraud Analyst</div>
          </div>
        </div>
      </div>
    </header>
  );
};
