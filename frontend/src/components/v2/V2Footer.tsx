import React from 'react';
import { ShieldAlert, BookOpen, ExternalLink, Lock } from 'lucide-react';

export const V2Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-[#E8EAED] text-[#727780] py-6 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
        {/* Guardrail Disclaimer */}
        <div className="flex items-start gap-2.5 max-w-2xl">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[#5F6368]">
            <strong className="text-[#202124]">Ethical AI & Compliance Safeguard:</strong> FraudShield AI V2 provides decision-support risk signals and factual transaction graph traversal. Connection to a suspicious flow does not establish criminal culpability. Automated account freezing, denial of service, or punitive action is strictly prohibited.
          </p>
        </div>

        {/* Links & Metadata */}
        <div className="flex items-center gap-4 shrink-0 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-700">
            <Lock className="w-3.5 h-3.5 text-teal-700" />
            Synthetic Core Ledger
          </span>
          <span className="text-slate-300">|</span>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-slate-600 hover:text-[#202124] transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            FastAPI OpenAPI
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </a>
        </div>
      </div>
    </footer>
  );
};

