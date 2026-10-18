import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Scale } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F4F0] flex">
      {/* Midnight-Navy Sidebar */}
      <Sidebar isMobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <Header onOpenMobileMenu={() => setMobileOpen(true)} />

        {/* Forensic Protocol & Fairness Safeguard Ribbon */}
        <div className="bg-[#0B1322] text-slate-200 border-b border-[#1C2B45] px-4 sm:px-6 py-1.5 text-[11px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Scale className="w-3.5 h-3.5 text-[#2DD4BF] flex-shrink-0" />
            <span className="truncate sm:whitespace-normal">
              <strong className="text-white font-semibold">Evidentiary Safeguard Protocol:</strong>{' '}
              Downstream fund connections and ML risk scores are statistical decision-support signals, not proof of complicity. Accounts are never automatically frozen.
            </span>
          </div>
          <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-[10px] bg-[#111C30] px-2 py-0.5 rounded border border-[#1C2B45] text-[#2DD4BF] flex-shrink-0">
            <span>SCENARIO: FS-1042</span>
          </span>
        </div>

        {/* Page Outlet */}
        <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
