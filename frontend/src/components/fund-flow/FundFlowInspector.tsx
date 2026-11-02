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
        return <Building className="w-4 h-4 text-mute" />;
      case 'student':
        return <GraduationCap className="w-4 h-4 text-ice" />;
      case 'sme':
        return <CreditCard className="w-4 h-4 text-iris-deep" />;
      default:
        return <User className="w-4 h-4 text-faint" />;
    }
  };

  // Helper node lookup
  const findNode = (id: string) => allNodes.find((n) => n.id === id);

  if (selectedNode) {
    const isV2Account = selectedNode.id.startsWith('ACC-');
    // Case accounts open inside their case; only account-mode traces come straight from the synthetic ledger.
    const accountUrl =
      mode === 'account'
        ? `/tools/accounts/${encodeURIComponent(selectedNode.id)}`
        : `/cases/${encodeURIComponent(caseId)}?section=accounts&account=${encodeURIComponent(selectedNode.id)}`;

    return (
      <div className="bg-white border border-line rounded-2xl p-5 shadow-xs text-xs space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className={`p-2 rounded-xl shrink-0 ${
                selectedNode.isRoot
                ? 'bg-white text-ink ring-1 ring-line shadow-[var(--shadow-xs)]'
                : 'bg-well border border-line'
              }`}
            >
              {getCustomerIcon(selectedNode.customerType)}
            </span>
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-iris font-mono block">
                {selectedNode.isRoot
                  ? 'ROOT ORIGIN ACCOUNT'
                  : `HOP ${selectedNode.hop} COUNTERPARTY`}
              </span>
              <h3 className="font-bold text-ink text-base font-display truncate">
                {selectedNode.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-mute text-xs">{selectedNode.id}</span>
                <button
                  type="button"
                  onClick={() => onFocusNode?.(selectedNode.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-iris/40 bg-iris-wash text-iris-deep hover:bg-iris-soft text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Focus and center this account in tree view"
                >
                  <LocateFixed className="w-3 h-3 text-iris" />
                  <span>Focus in Tree</span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-ink p-1 rounded-lg hover:bg-well cursor-pointer"
            title="Close Inspector"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Verification & KYC Snapshot */}
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="bg-well p-2.5 rounded-xl border border-line/70">
            <span className="text-faint block text-[11px]">Customer Type</span>
            <span className="capitalize text-ink font-semibold">
              {selectedNode.customerType.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="bg-well p-2.5 rounded-xl border border-line/70">
            <span className="text-faint block text-[11px]">Verification Tier</span>
            <span className="capitalize text-ink font-semibold">
              {selectedNode.kycTier.replace(/_/g, ' ')}
            </span>
          </div>

          {selectedNode.currentBalance !== null && (
            <div className="col-span-2 bg-well p-2.5 rounded-xl border border-line/70 flex items-center justify-between">
              <div>
                <span className="text-faint block text-[11px]">Current Balance</span>
                <span className="font-bold text-ink text-sm tabular-nums">
                  ₹{selectedNode.currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white border border-line text-mute">
                {selectedNode.statusLabel}
              </span>
            </div>
          )}
        </div>

        {/* Connected Transactions in Tree */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink text-xs">Connected Tree Transfers</span>
            <span className="font-mono text-[11px] text-mute">
              {connectedTransfers.incoming.length} In · {connectedTransfers.outgoing.length} Out
            </span>
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5 font-mono text-xs">
            {connectedTransfers.incoming.map((e) => (
              <div
                key={e.id}
                onClick={() => onSelectEdge(e)}
                className="p-2 rounded-xl bg-ok-soft border border-ok-line flex items-center justify-between gap-1 text-ok hover:border-ok-fill cursor-pointer transition-colors"
                title="Click to inspect this transfer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-ok-fill shrink-0" />
                  <span className="truncate">From {e.source}</span>
                </div>
                <span className="font-bold text-ok shrink-0">
                  +₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}

            {connectedTransfers.outgoing.map((e) => (
              <div
                key={e.id}
                onClick={() => onSelectEdge(e)}
                className="p-2 rounded-xl bg-danger-soft border border-danger-line flex items-center justify-between gap-1 text-danger hover:border-danger cursor-pointer transition-colors"
                title="Click to inspect this transfer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <ArrowUpRight className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span className="truncate">To {e.target}</span>
                </div>
                <span className="font-bold text-danger shrink-0">
                  -₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}

            {connectedTransfers.incoming.length === 0 && connectedTransfers.outgoing.length === 0 && (
              <p className="text-faint italic text-xs py-2 text-center">
                No direct transfers recorded for this node in the active view window.
              </p>
            )}
          </div>
        </div>

        {/* Live Analysis Feedback (if executed) */}
        {analysisResult && (
          <div className="p-3 rounded-xl bg-iris-wash border border-iris-line text-iris-deep space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5 text-iris" />
              <span>Live ML Assessment Complete</span>
            </div>
            <p className="text-[11px] leading-tight text-mute">
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
        <div className="pt-2 border-t border-line space-y-2">
          {isV2Account ? (
            <>
              <Link
                to={accountUrl}
                className="btn-primary w-full"
              >
                <span>Open Account 360° Profile</span>
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                to={`${accountUrl}?tab=transactions`}
                className="w-full py-2 px-3 rounded-xl bg-white hover:bg-well text-ink border border-line font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>View Ledger Transactions</span>
                <ExternalLink className="w-3.5 h-3.5 text-faint" />
              </Link>
            </>
          ) : (
            <>
              <Link
                to={`/cases/${encodeURIComponent(caseId)}?section=review&account=${encodeURIComponent(selectedNode.id)}`}
                className="btn-primary w-full"
              >
                <span>Record a decision in case {caseId}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                to={`/cases/${encodeURIComponent(caseId)}?section=accounts&account=${encodeURIComponent(selectedNode.id)}`}
                className="w-full py-2 px-3 rounded-xl bg-white hover:bg-well text-ink border border-line font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Account details in case</span>
                <ExternalLink className="w-3.5 h-3.5 text-faint" />
              </Link>
            </>
          )}

          {isV2Account && (
            <button
              type="button"
              disabled={runningAnalysis}
              onClick={() => handleRunLiveAnalysis(selectedNode.id)}
              className="w-full py-2 px-3 rounded-xl bg-well hover:bg-iris-soft text-mute hover:text-iris border border-line font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${runningAnalysis ? 'animate-spin' : ''}`} />
              <span>{runningAnalysis ? 'Running Live Analysis...' : 'Run Live ML Analysis'}</span>
            </button>
          )}

          {mode === 'case' && (
            <Link
              to={`/cases/${encodeURIComponent(caseId)}`}
              className="w-full py-2 px-3 rounded-xl bg-well hover:bg-white text-mute hover:text-ink border border-line font-semibold flex items-center justify-center gap-1.5 transition-colors text-center"
            >
              <span>Open case {caseId}</span>
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
      <div className="bg-white border border-line rounded-2xl p-5 shadow-xs text-xs space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-line">
          <div>
            <span className="text-[11px] font-bold text-iris font-mono block">
              {selectedEdge.isCycle ? 'CIRCULAR TRANSFER LOOP' : `HOP ${selectedEdge.hop} DIRECTED LEG`}
            </span>
            <h3 className="font-bold text-ink text-lg font-mono">
              ₹{selectedEdge.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </h3>
            <span className="font-mono text-mute text-xs">{selectedEdge.id}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-ink p-1 rounded-lg hover:bg-well cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Counterparty Connections */}
        <div className="space-y-2.5 font-mono text-xs">
          <div className="p-2.5 rounded-xl bg-well border border-line flex items-center justify-between">
            <span className="text-faint text-[11px]">Origin Account:</span>
            <button
              type="button"
              onClick={() => {
                if (sourceNode) onSelectNode(sourceNode);
              }}
              className="font-bold text-iris hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{selectedEdge.source}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 rounded-xl bg-well border border-line flex items-center justify-between">
            <span className="text-faint text-[11px]">Destination:</span>
            <button
              type="button"
              onClick={() => {
                if (targetNode) onSelectNode(targetNode);
              }}
              className="font-bold text-iris hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{selectedEdge.target}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 bg-well rounded-xl border border-line/70">
              <span className="text-faint block text-[11px]">Payment Rail</span>
              <span className="font-bold text-ink">{selectedEdge.channel}</span>
            </div>
            <div className="p-2 bg-well rounded-xl border border-line/70">
              <span className="text-faint block text-[11px]">Hop Distance</span>
              <span className="font-bold text-ink">Hop {selectedEdge.hop}</span>
            </div>
          </div>

          <div className="p-2 bg-well rounded-xl border border-line/70 text-[11px]">
            <span className="text-faint block text-[11px]">Timestamp</span>
            <span className="font-semibold text-ink">
              {selectedEdge.timestamp ? selectedEdge.timestamp.replace('T', ' ') : 'N/A'}
            </span>
          </div>

          {selectedEdge.attributedAmount !== null && (
            <div className="p-2.5 bg-iris-soft rounded-xl border border-iris-line text-iris-deep">
              <span className="text-[11px] font-bold block">Attributed Fund Exposure</span>
              <span className="font-bold text-sm">₹{selectedEdge.attributedAmount.toLocaleString('en-IN')}</span>
            </div>
          )}
        </div>

      </div>
    );
  }

  // Empty State: Helpful guidance & quick account selector
  return (
    <div className="bg-white border border-line rounded-2xl p-5 shadow-xs text-xs space-y-4">
      <div className="flex items-start gap-3 pb-3 border-b border-line">
        <div className="p-2.5 rounded-xl bg-iris-soft text-iris border border-iris-line">
          <GitBranch className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-ink font-display">
            Selected Account Inspector
          </h3>
          <p className="text-mute text-xs leading-relaxed mt-0.5">
            Click any account card or transfer line in the tree to inspect counterparty relationships, verify KYC status, and follow the funds step by step.
          </p>
        </div>
      </div>

      {/* Quick Jump Account Buttons */}
      {allNodes.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] font-mono font-bold text-faint block">
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
                className="w-full p-2.5 rounded-xl bg-well hover:bg-iris-soft border border-line hover:border-iris text-left transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-mono font-bold text-xs text-ink truncate">
                    {n.id}
                  </div>
                  <div className="text-[11px] text-mute truncate">{n.name}</div>
                </div>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white border border-line text-mute shrink-0">
                  {n.isRoot ? 'Root' : `Hop ${n.hop}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lineage Anti-Double-Counting Guardrail Box */}
      <div className="p-3.5 rounded-xl bg-well border border-line text-[11px] text-mute space-y-1.5">
        <span className="font-bold text-ink block">Forensic Accounting Rule</span>
        <p className="leading-relaxed">
          Initial transfers represent the root exposure ceiling. Downstream re-transfers are ledger movements and must not be summed into an inflated loss total.
        </p>
      </div>
    </div>
  );
};
