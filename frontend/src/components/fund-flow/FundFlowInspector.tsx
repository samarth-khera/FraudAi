import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  X,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  User,
  Building,
  GraduationCap,
  CreditCard,
  Repeat,
  AlertTriangle,
  Play,
  CheckCircle2,
  Clock,
  Sparkles,
  GitBranch,
  LocateFixed,
} from 'lucide-react';
import { UnifiedTreeNode, UnifiedTreeEdge } from '../../services/unifiedFlowAdapter';
import { v2Api } from '../../services/v2Api';

export interface FundFlowInspectorProps {
  selectedNode: UnifiedTreeNode | null;
  selectedEdge: UnifiedTreeEdge | null;
  allEdges: UnifiedTreeEdge[];
  allNodes: UnifiedTreeNode[];
  onSelectNode: (node: UnifiedTreeNode | null) => void;
  onSelectEdge: (edge: UnifiedTreeEdge | null) => void;
  onClose: () => void;
  mode: 'account' | 'case';
  caseId?: string;
  onFocusNode?: (nodeId: string) => void;
}

export const FundFlowInspector: React.FC<FundFlowInspectorProps> = ({
  selectedNode,
  selectedEdge,
  allEdges,
  allNodes,
  onSelectNode,
  onSelectEdge,
  onClose,
  mode,
  caseId = 'FS-1042',
  onFocusNode,
}) => {
  const navigate = useNavigate();
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Connected incoming & outgoing transfers for selected node
  const connectedTransfers = React.useMemo(() => {
    if (!selectedNode) return { incoming: [], outgoing: [] };
    const incoming = allEdges.filter((e) => e.target === selectedNode.id);
    const outgoing = allEdges.filter((e) => e.source === selectedNode.id);
    return { incoming, outgoing };
  }, [selectedNode, allEdges]);

  // Handle on-demand Live Analysis (never triggered automatically)
  const handleRunLiveAnalysis = async (accountId: string) => {
    setRunningAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await v2Api.runLiveAnalysis(accountId);
      setAnalysisResult(res);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Live analysis failed.');
    } finally {
      setRunningAnalysis(false);
    }
  };

  // Helper customer icon
  const getCustomerIcon = (customerType?: string) => {
    switch (customerType?.toLowerCase()) {
      case 'corporate':
        return <Building className="w-4 h-4 text-[#6B655B]" />;
      case 'student':
        return <GraduationCap className="w-4 h-4 text-[#3B82F6]" />;
      case 'sme':
        return <CreditCard className="w-4 h-4 text-[#0F766E]" />;
      default:
        return <User className="w-4 h-4 text-[#8C857B]" />;
    }
  };

  // Helper node lookup
  const findNode = (id: string) => allNodes.find((n) => n.id === id);

  if (selectedNode) {
    const isV2Account = selectedNode.id.startsWith('ACC-');
    const accountUrl = isV2Account
      ? `/v2/accounts/${selectedNode.id}`
      : `/accounts/${selectedNode.id}`;

    return (
      <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 shadow-xs text-xs space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#EAE3D6]">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className={`p-2 rounded-xl shrink-0 ${
                selectedNode.isRoot
                  ? 'bg-[#EA8500] text-white shadow-xs'
                  : 'bg-[#FAF7F2] border border-[#EAE3D6]'
              }`}
            >
              {getCustomerIcon(selectedNode.customerType)}
            </span>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#EA8500] font-mono block">
                {selectedNode.isRoot
                  ? 'ROOT ORIGIN ACCOUNT'
                  : `HOP ${selectedNode.hop} COUNTERPARTY`}
              </span>
              <h3 className="font-bold text-[#1A1714] text-base font-display truncate">
                {selectedNode.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-[#6B655B] text-xs">{selectedNode.id}</span>
                <button
                  type="button"
                  onClick={() => onFocusNode?.(selectedNode.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#EA8500]/40 bg-[#FFF8EE] text-[#C05621] hover:bg-[#FFF4E6] text-[10px] font-semibold transition-colors cursor-pointer"
                  title="Focus and center this account in tree view"
                >
                  <LocateFixed className="w-3 h-3 text-[#EA8500]" />
                  <span>Focus in Tree</span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#8C857B] hover:text-[#1A1714] p-1 rounded-lg hover:bg-[#FAF7F2] cursor-pointer"
            title="Close Inspector"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Verification & KYC Snapshot */}
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="bg-[#FAF7F2] p-2.5 rounded-xl border border-[#EAE3D6]/70">
            <span className="text-[#8C857B] block text-[10px]">Customer Type</span>
            <span className="capitalize text-[#1A1714] font-semibold">
              {selectedNode.customerType.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="bg-[#FAF7F2] p-2.5 rounded-xl border border-[#EAE3D6]/70">
            <span className="text-[#8C857B] block text-[10px]">Verification Tier</span>
            <span className="capitalize text-[#1A1714] font-semibold">
              {selectedNode.kycTier.replace(/_/g, ' ')}
            </span>
          </div>

          {selectedNode.currentBalance !== null && (
            <div className="col-span-2 bg-[#FAF7F2] p-2.5 rounded-xl border border-[#EAE3D6]/70 flex items-center justify-between">
              <div>
                <span className="text-[#8C857B] block text-[10px]">Current Balance</span>
                <span className="font-bold text-[#1A1714] text-sm tabular-nums">
                  ₹{selectedNode.currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-[#EAE3D6] text-[#6B655B]">
                {selectedNode.statusLabel}
              </span>
            </div>
          )}
        </div>

        {/* Connected Transactions in Tree */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#1A1714] text-xs">Connected Tree Transfers</span>
            <span className="font-mono text-[11px] text-[#6B655B]">
              {connectedTransfers.incoming.length} In · {connectedTransfers.outgoing.length} Out
            </span>
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5 font-mono text-xs">
            {connectedTransfers.incoming.map((e) => (
              <div
                key={e.id}
                onClick={() => onSelectEdge(e)}
                className="p-2 rounded-xl bg-[#EAF7EE] border border-[#BBF7D0] flex items-center justify-between gap-1 text-[#166534] hover:border-[#22C55E] cursor-pointer transition-colors"
                title="Click to inspect this transfer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
                  <span className="truncate">From {e.source}</span>
                </div>
                <span className="font-bold text-[#166534] shrink-0">
                  +₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}

            {connectedTransfers.outgoing.map((e) => (
              <div
                key={e.id}
                onClick={() => onSelectEdge(e)}
                className="p-2 rounded-xl bg-[#FFF0F2] border border-[#FECDD3] flex items-center justify-between gap-1 text-[#BE123C] hover:border-[#E11D48] cursor-pointer transition-colors"
                title="Click to inspect this transfer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                  <span className="truncate">To {e.target}</span>
                </div>
                <span className="font-bold text-[#BE123C] shrink-0">
                  -₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}

            {connectedTransfers.incoming.length === 0 && connectedTransfers.outgoing.length === 0 && (
              <p className="text-[#8C857B] italic text-xs py-2 text-center">
                No direct transfers recorded for this node in the active view window.
              </p>
            )}
          </div>
        </div>

        {/* Live Analysis Feedback (if executed) */}
        {analysisResult && (
          <div className="p-3 rounded-xl bg-[#FFF8EE] border border-[#FCD5B5] text-[#C05621] space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5 text-[#EA8500]" />
              <span>Live ML Assessment Complete</span>
            </div>
            <p className="text-[11px] leading-tight text-[#6B655B]">
              Calculated risk score: <strong>{analysisResult.assessment?.risk_score ?? 'N/A'}/100</strong> ({analysisResult.assessment?.risk_level ?? 'Normal'}).
            </p>
          </div>
        )}

        {analysisError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {analysisError}
          </div>
        )}

        {/* Primary Action Buttons */}
        <div className="pt-2 border-t border-[#EAE3D6] space-y-2">
          <Link
            to={accountUrl}
            className="w-full py-2.5 px-3 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
          >
            <span>Open Account 360° Profile</span>
            <ArrowRight className="w-4 h-4" />
          </Link>

          <Link
            to={`${accountUrl}?tab=transactions`}
            className="w-full py-2 px-3 rounded-xl bg-white hover:bg-[#FAF7F2] text-[#1A1714] border border-[#EAE3D6] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>View Ledger Transactions</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#8C857B]" />
          </Link>

          {isV2Account && (
            <button
              type="button"
              disabled={runningAnalysis}
              onClick={() => handleRunLiveAnalysis(selectedNode.id)}
              className="w-full py-2 px-3 rounded-xl bg-[#FAF7F2] hover:bg-[#FFF4E6] text-[#6B655B] hover:text-[#EA8500] border border-[#EAE3D6] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${runningAnalysis ? 'animate-spin' : ''}`} />
              <span>{runningAnalysis ? 'Running Live Analysis...' : 'Run Live ML Analysis'}</span>
            </button>
          )}

          {mode === 'case' && (
            <Link
              to={`/app/cases/${encodeURIComponent(caseId)}`}
              className="w-full py-2 px-3 rounded-xl bg-[#FAF7F2] hover:bg-white text-[#6B655B] hover:text-[#1A1714] border border-[#EAE3D6] font-semibold flex items-center justify-center gap-1.5 transition-colors text-center"
            >
              <span>View Case Dossier &amp; Record Review</span>
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    const sourceNode = findNode(selectedEdge.source);
    const targetNode = findNode(selectedEdge.target);

    return (
      <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 shadow-xs text-xs space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#EAE3D6]">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#EA8500] font-mono block">
              {selectedEdge.isCycle ? 'CIRCULAR TRANSFER LOOP' : `HOP ${selectedEdge.hop} DIRECTED LEG`}
            </span>
            <h3 className="font-bold text-[#1A1714] text-lg font-mono">
              ₹{selectedEdge.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </h3>
            <span className="font-mono text-[#6B655B] text-xs">{selectedEdge.id}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#8C857B] hover:text-[#1A1714] p-1 rounded-lg hover:bg-[#FAF7F2] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Counterparty Connections */}
        <div className="space-y-2.5 font-mono text-xs">
          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-between">
            <span className="text-[#8C857B] text-[11px]">Origin Account:</span>
            <button
              type="button"
              onClick={() => {
                if (sourceNode) onSelectNode(sourceNode);
              }}
              className="font-bold text-[#EA8500] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{selectedEdge.source}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] flex items-center justify-between">
            <span className="text-[#8C857B] text-[11px]">Destination:</span>
            <button
              type="button"
              onClick={() => {
                if (targetNode) onSelectNode(targetNode);
              }}
              className="font-bold text-[#EA8500] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{selectedEdge.target}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 bg-[#FAF7F2] rounded-xl border border-[#EAE3D6]/70">
              <span className="text-[#8C857B] block text-[10px]">Payment Rail</span>
              <span className="font-bold text-[#1A1714]">{selectedEdge.channel}</span>
            </div>
            <div className="p-2 bg-[#FAF7F2] rounded-xl border border-[#EAE3D6]/70">
              <span className="text-[#8C857B] block text-[10px]">Hop Distance</span>
              <span className="font-bold text-[#1A1714]">Hop {selectedEdge.hop}</span>
            </div>
          </div>

          <div className="p-2 bg-[#FAF7F2] rounded-xl border border-[#EAE3D6]/70 text-[11px]">
            <span className="text-[#8C857B] block text-[10px]">Timestamp</span>
            <span className="font-semibold text-[#1A1714]">
              {selectedEdge.timestamp ? selectedEdge.timestamp.replace('T', ' ') : 'N/A'}
            </span>
          </div>

          {selectedEdge.attributedAmount !== null && (
            <div className="p-2.5 bg-[#FFF4E6] rounded-xl border border-[#FCD5B5] text-[#C05621]">
              <span className="text-[10px] uppercase font-bold block">Attributed Fund Exposure</span>
              <span className="font-bold text-sm">₹{selectedEdge.attributedAmount.toLocaleString('en-IN')}</span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="pt-2 border-t border-[#EAE3D6]">
          <Link
            to={`/app/transaction-check?txId=${encodeURIComponent(selectedEdge.id)}`}
            className="w-full py-2.5 px-3 rounded-xl bg-[#EA8500] hover:bg-[#D27400] text-white font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs text-center"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Score &amp; Explain in Risk Engine</span>
          </Link>
        </div>
      </div>
    );
  }

  // Empty State: Helpful guidance & quick account selector
  return (
    <div className="bg-white border border-[#EAE3D6] rounded-2xl p-5 shadow-xs text-xs space-y-4">
      <div className="flex items-start gap-3 pb-3 border-b border-[#EAE3D6]">
        <div className="p-2.5 rounded-xl bg-[#FFF4E6] text-[#EA8500] border border-[#FCD5B5]">
          <GitBranch className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#1A1714] font-display">
            Selected Account Inspector
          </h3>
          <p className="text-[#6B655B] text-xs leading-relaxed mt-0.5">
            Click any account card or transfer line in the tree to inspect counterparty relationships, verify KYC status, and follow the funds step by step.
          </p>
        </div>
      </div>

      {/* Quick Jump Account Buttons */}
      {allNodes.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-mono font-bold text-[#8C857B] uppercase tracking-wider block">
            Accounts in Tree ({allNodes.length})
          </span>
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {allNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onSelectNode(n);
                  onFocusNode?.(n.id);
                }}
                className="w-full p-2.5 rounded-xl bg-[#FAF7F2] hover:bg-[#FFF4E6] border border-[#EAE3D6] hover:border-[#EA8500] text-left transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-mono font-bold text-xs text-[#1A1714] truncate">
                    {n.id}
                  </div>
                  <div className="text-[11px] text-[#6B655B] truncate">{n.name}</div>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white border border-[#EAE3D6] text-[#6B655B] shrink-0">
                  {n.isRoot ? 'Root' : `Hop ${n.hop}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lineage Anti-Double-Counting Guardrail Box */}
      <div className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#EAE3D6] text-[11px] text-[#6B655B] space-y-1.5">
        <span className="font-bold text-[#1A1714] block">Forensic Accounting Rule</span>
        <p className="leading-relaxed">
          Initial transfers represent the root exposure ceiling. Downstream re-transfers are ledger movements and must not be summed into an inflated loss total.
        </p>
      </div>
    </div>
  );
};
