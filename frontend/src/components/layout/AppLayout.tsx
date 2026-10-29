import React from 'react';
import { Outlet } from 'react-router-dom';
import { UnifiedHeader } from './UnifiedHeader';
import { V2Footer } from '../v2/V2Footer';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#F8F6F0] flex flex-col text-[#1A1714]">
      <UnifiedHeader />
      <main id="main" className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
      <V2Footer />
    </div>
  );
};

export default AppLayout;
