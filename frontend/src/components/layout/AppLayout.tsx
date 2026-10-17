import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AlertCircle } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f8fafd] flex">
      {/* Sidebar */}
      <Sidebar isMobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <Header onOpenMobileMenu={() => setMobileOpen(true)} />

        {/* Prototype Safeguard Notice */}
        <div className="bg-indigo-50/90 border-b border-indigo-100/80 px-4 sm:px-6 py-2 text-xs text-indigo-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
            <span>
              <strong>Fairness & Decision-Support Notice:</strong> FraudShield AI separates fund flow connections from guilt. Downstream recipient connections do not imply wrongdoing. Accounts are never automatically frozen.
            </span>
          </div>
          <span className="hidden md:inline font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-indigo-200/80 text-indigo-700">
            DEMO FS-1042
          </span>
        </div>

        {/* Page Outlet */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
