import React from 'react';
import { Outlet } from 'react-router-dom';
import { UnifiedHeader } from './UnifiedHeader';
import { V2Footer } from '../v2/V2Footer';

export const AppLayout: React.FC = () => (
  <div className="min-h-screen flex flex-col text-ink">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 btn-secondary">
      Skip to content
    </a>
    <UnifiedHeader />
    <div className="flex-1 flex flex-col lg:pl-[248px] min-w-0">
      <main id="main" className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10 min-w-0">
        <Outlet />
      </main>
      <V2Footer />
    </div>
  </div>
);

export default AppLayout;
