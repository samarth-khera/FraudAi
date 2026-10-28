import React from 'react';
import { Link } from 'react-router-dom';

export const V2Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-[#EAE3D6] bg-white px-4 sm:px-6 lg:px-8 py-6 text-xs text-[#6B655B]">
      <div className="max-w-[1280px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="max-w-2xl leading-relaxed">
          FraudShield AI supports investigators; it does not decide guilt or freeze accounts. Receiving money in a case is
          not evidence of wrongdoing. All data in this environment is synthetic.
        </p>
        <nav aria-label="Footer" className="flex items-center gap-4 font-semibold">
          <Link to="/cases" className="hover:text-[#B45309]">Investigations</Link>
          <Link to="/tools" className="hover:text-[#B45309]">Tools</Link>
        </nav>
      </div>
    </footer>
  );
};
