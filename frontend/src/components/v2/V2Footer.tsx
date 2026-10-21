import React from 'react';
import { ShieldAlert, BookOpen, ExternalLink, Lock } from 'lucide-react';

export const V2Footer: React.FC = () => {
  return (
    <footer className="bg-[#0B1322] border-t border-[#1C2B45] text-slate-400 py-6 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
        {/* Guardrail Disclaimer */}
        <div className="flex items-start gap-2.5 max-w-2xl">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong className="text-slate-200">Ethical AI & Compliance Safeguard:</strong> FraudShield AI V2 provides decision-support risk signals and factual transaction graph traversal. Connection to a suspicious flow does not establish criminal culpability. Automated account freezing, denial of service, or punitive action is strictly prohibited.
          </p>
        </div>

        {/* Links & Metadata */}
        <div className="flex items-center gap-4 shrink-0 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-slate-300">
            <Lock className="w-3.5 h-3.5 text-[#2DD4BF]" />
            Synthetic Core Ledger
          </span>
          <span className="text-slate-600">|</span>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            FastAPI OpenAPI
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </a>
        </div>
      </div>
    </footer>
  );
};
