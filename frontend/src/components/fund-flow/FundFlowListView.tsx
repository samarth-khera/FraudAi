import React, { useMemo, useState } from 'react';
import { Search, Filter, Repeat, ArrowUpRight, ShieldCheck, ArrowRight } from 'lucide-react';
import { UnifiedTreeEdge, UnifiedTreeNode } from '../../services/unifiedFlowAdapter';

interface FundFlowListViewProps {
  edges: UnifiedTreeEdge[];
  nodes: UnifiedTreeNode[];
  selectedEdgeId: string | null;
  onSelectEdge: (edge: UnifiedTreeEdge | null) => void;
  onSelectNodeById: (accountId: string) => void;
}

export const FundFlowListView: React.FC<FundFlowListViewProps> = ({
  edges,
  nodes,
  selectedEdgeId,
  onSelectEdge,
  onSelectNodeById,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedHop, setSelectedHop] = useState<string>('all');

  // Channels present in current data
  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    edges.forEach((e) => {
      if (e.channel) set.add(e.channel);
    });
    return Array.from(set).sort();
  }, [edges]);

  // Hops present
  const availableHops = useMemo(() => {
    const set = new Set<number>();
    edges.forEach((e) => set.add(e.hop));
    return Array.from(set).sort((a, b) => a - b);
  }, [edges]);

  // Filtered edges
  const filteredEdges = useMemo(() => {
    return edges.filter((e) => {
      if (selectedChannel !== 'all' && e.channel !== selectedChannel) return false;
      if (selectedHop !== 'all' && String(e.hop) !== selectedHop) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchId = e.id.toLowerCase().includes(q);
        const matchSource = e.source.toLowerCase().includes(q);
        const matchTarget = e.target.toLowerCase().includes(q);
        const matchChannel = e.channel.toLowerCase().includes(q);
        if (!matchId && !matchSource && !matchTarget && !matchChannel) return false;
      }

      return true;
    });
  }, [edges, searchTerm, selectedChannel, selectedHop]);

  return (
    <div className="bg-white border border-[#E4E5F0] rounded-2xl p-5 shadow-xs space-y-4">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#868AA2]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Account ID, TX ID, or Rail..."
            className="w-full pl-9 pr-3 py-2 bg-[#F6F6FC] border border-[#E4E5F0] rounded-xl text-xs text-[#141526] placeholder:text-[#868AA2] focus:outline-none focus:border-[#6246EA] font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Channel Filter */}
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="bg-[#F6F6FC] border border-[#E4E5F0] rounded-xl px-2.5 py-1.5 text-xs text-[#141526] font-medium focus:outline-none focus:border-[#6246EA] cursor-pointer"
            aria-label="Filter by Rail"
          >
            <option value="all">All Payment Rails</option>
            {availableChannels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Hop Filter */}
          <select
            value={selectedHop}
            onChange={(e) => setSelectedHop(e.target.value)}
            className="bg-[#F6F6FC] border border-[#E4E5F0] rounded-xl px-2.5 py-1.5 text-xs text-[#141526] font-medium focus:outline-none focus:border-[#6246EA] cursor-pointer"
            aria-label="Filter by Hop Depth"
          >
            <option value="all">All Hops</option>
            {availableHops.map((h) => (
              <option key={h} value={String(h)}>
                Hop {h}
              </option>
            ))}
          </select>

          <span className="font-mono text-[11px] text-[#5C6079] ml-1">
            Showing {filteredEdges.length} of {edges.length} transfers
          </span>
        </div>
      </div>

      {/* Accessible Table */}
      <div className="overflow-x-auto border border-[#E4E5F0] rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F6F6FC] border-b border-[#E4E5F0] text-[#5C6079] font-bold font-mono text-[11px]">
            <tr>
              <th className="px-3.5 py-3">Hop</th>
              <th className="px-3.5 py-3">Transaction ID</th>
              <th className="px-3.5 py-3">From Account</th>
              <th className="px-3.5 py-3">To Account</th>
              <th className="px-3.5 py-3 text-right">Amount</th>
              <th className="px-3.5 py-3">Rail</th>
              <th className="px-3.5 py-3">Timestamp</th>
              <th className="px-3.5 py-3">Pattern</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4E5F0]/70 font-mono text-xs">
            {filteredEdges.map((e) => {
              const isSelected = selectedEdgeId === e.id;
              return (
                <tr
                  key={e.id}
                  onClick={() => onSelectEdge(e)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#EFECFF] font-semibold text-[#4F33D6]'
                      : 'hover:bg-[#F6F6FC]'
                  }`}
                >
                  <td className="px-3.5 py-2.5 text-[#5C6079] font-bold">Hop {e.hop}</td>
                  <td className="px-3.5 py-2.5 text-[#141526] font-bold">{e.id}</td>
                  <td className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelectNodeById(e.source);
                      }}
                      className="text-[#6246EA] hover:underline font-bold inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>{e.source}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelectNodeById(e.target);
                      }}
                      className="text-[#6246EA] hover:underline font-bold inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>{e.target}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-bold text-[#141526] tabular-nums">
                    ₹{e.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3.5 py-2.5 font-sans">
                    <span className="px-2 py-0.5 rounded-lg bg-[#F6F6FC] border border-[#E4E5F0] text-[#5C6079] text-[11px] font-semibold">
                      {e.channel}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-[#5C6079] text-[11px] whitespace-nowrap">
                    {e.timestamp ? e.timestamp.replace('T', ' ') : 'N/A'}
                  </td>
                  <td className="px-3.5 py-2.5 font-sans">
                    {e.isCycle ? (
                      <span className="px-2 py-0.5 rounded-md bg-[#F5F3FF] text-[#4F33D6] text-[10px] font-bold border border-[#D7CFFF] inline-flex items-center gap-1">
                        <Repeat className="w-2.5 h-2.5" />
                        <span>Loop</span>
                      </span>
                    ) : (
                      <span className="text-[#868AA2] text-[11px]">Direct Hop</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {filteredEdges.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-[#868AA2] italic">
                  No transaction legs match the selected filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
