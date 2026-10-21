import React from 'react';
import { ShieldAlert, BookOpen, ExternalLink, Lock } from 'lucide-react';

export const V2Footer: React.FC = () => {
  return (
    <footer className="bg-[#0B0F14] border-t border-[#293543] text-[#9CAAB6] py-6 px-4 sm:px-6 lg:px-8 mt-auto shadow-[0_-4px_20px_rgba(0,0,0,0.6)]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
        {/* Guardrail Disclaimer */}
        <div className="flex items-start gap-2.5 max-w-2xl">
          <ShieldAlert className="w-4 h-4 text-[#C8F169] shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[#9CAAB6]">
            <strong className="text-[#F3F6F8] font-bold">Ethical AI & Compliance Safeguard:</strong> FraudShield AI V2 provides decision-support risk signals and factual transaction graph traversal. Connection to a suspicious flow does not establish criminal culpability. Automated account freezing, denial of service, or punitive action is strictly prohibited.
          </p>
        </div>

        {/* Links & Metadata */}
        <div className="flex items-center gap-4 shrink-0 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-[#F3F6F8] font-medium">
            <Lock className="w-3.5 h-3.5 text-[#C8F169]" />
            Synthetic Core Ledger
          </span>
          <span className="text-[#293543]">|</span>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[#9CAAB6] hover:text-[#C8F169] font-medium transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#627181]" />
            FastAPI OpenAPI
            <ExternalLink className="w-3 h-3 text-[#627181]" />
          </a>
        </div>
      </div>
    </footer>
  );
};
