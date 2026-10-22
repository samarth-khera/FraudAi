import React from 'react';
import { Outlet } from 'react-router-dom';
import { UnifiedHeader } from './UnifiedHeader';
import { V2Footer } from '../v2/V2Footer';
import { Scale } from 'lucide-react';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#F8F6F0] flex flex-col text-[#1A1714]">
      {/* Unified Platform Header */}
      <UnifiedHeader />

      {/* Forensic Protocol & Fairness Safeguard Ribbon */}
      <div className="bg-[#FFF4E6] border-b border-[#FCD5B5] px-4 sm:px-6 lg:px-8 py-2 text-xs shadow-2xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Scale className="w-3.5 h-3.5 text-[#EA8500] shrink-0" />
            <span className="truncate sm:whitespace-normal text-[11px] text-[#6B655B] leading-tight">
              <strong className="text-[#1A1714] font-bold">Evidentiary Safeguard Protocol:</strong>{' '}
              Downstream fund connections and ML risk scores are statistical decision-support signals, not proof of complicity. Automated account freezing is strictly prohibited.
            </span>
          </div>
          <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-[10px] bg-[#FAF7F2] px-2.5 py-0.5 rounded-full border border-[#EAE3D6] text-[#1A1714] font-semibold shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#EA8500]" />
            <span>SCENARIO: FS-1042</span>
          </span>
        </div>
      </div>

      {/* Page Outlet Frame */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>

      {/* Unified Footer */}
      <V2Footer />
    </div>
  );
};

export default AppLayout;
