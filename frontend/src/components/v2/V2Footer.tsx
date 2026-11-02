import React from 'react';
import { ShieldCheck } from 'lucide-react';

export const V2Footer: React.FC = () => (
  <footer data-print-hide className="mt-auto px-4 sm:px-6 lg:px-10 pb-8">
    <div className="max-w-[1360px] mx-auto border-t border-line pt-5 flex gap-3 text-xs text-faint">
      <ShieldCheck className="w-4 h-4 shrink-0 text-faint" aria-hidden="true" />
      <p className="max-w-3xl leading-relaxed">
        FraudShield supports investigators; it does not decide guilt or freeze accounts. Receiving money in a case is not
        evidence of wrongdoing. All data in this environment is synthetic.
      </p>
    </div>
  </footer>
);
