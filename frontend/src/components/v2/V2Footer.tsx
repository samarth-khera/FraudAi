import React from 'react';
import { ShieldAlert, BookOpen, ExternalLink, Lock } from 'lucide-react';

export const V2Footer: React.FC = () => {
  return (
    <footer className="bg-[#FFFEFA] border-t border-[#E8E0D4] text-[#737373] py-6 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
        {/* Guardrail Disclaimer */}
        <div className="flex items-start gap-2.5 max-w-2xl">
          <ShieldAlert className="w-4 h-4 text-[#EA8500] shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[#737373]">
            <strong className="text-[#242424]">Ethical AI & Compliance Safeguard:</strong> FraudShield AI V2 provides decision-support risk signals and factual transaction graph traversal. Connection to a suspicious flow does not establish criminal culpability. Automated account freezing, denial of service, or punitive action is strictly prohibited.
          </p>
        </div>

        {/* Links & Metadata */}
        <div className="flex items-center gap-4 shrink-0 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-[#555555]">
            <Lock className="w-3.5 h-3.5 text-[#EA8500]" />
            Synthetic Core Ledger
          </span>
          <span className="text-[#D1C7B7]">|</span>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[#737373] hover:text-[#EA8500] transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#8C8C8C]" />
            FastAPI OpenAPI
            <ExternalLink className="w-3 h-3 text-[#8C8C8C]" />
          </a>
        </div>
      </div>
    </footer>
  );
};

