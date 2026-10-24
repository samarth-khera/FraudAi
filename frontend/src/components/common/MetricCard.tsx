import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral' | 'warning';
  icon: React.ReactNode;
  iconBg?: string;
  subtitle?: string;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  changeType = 'neutral',
  icon,
  iconBg = 'bg-[#F0FDFA] text-[#0F766E] border-[#CCFBF1]',
  subtitle,
  className = '',
}) => {
  const getChangeColor = () => {
    switch (changeType) {
      case 'positive':
        return 'text-emerald-800 bg-emerald-50 border-emerald-200';
      case 'negative':
        return 'text-red-800 bg-red-50 border-red-200';
      case 'warning':
        return 'text-amber-900 bg-amber-50 border-amber-200';
      default:
        return 'text-[#334155] bg-[#F5F4F0] border-[#D6D3CD]';
    }
  };

  const getTopBarColor = () => {
    switch (changeType) {
      case 'positive':
        return 'bg-emerald-600';
      case 'negative':
        return 'bg-red-600';
      case 'warning':
        return 'bg-amber-500';
      default:
        return 'bg-[#EA8500]';
    }
  };

  return (
    <div
      className={`bg-white border border-[#EAE3D6] rounded-2xl relative overflow-hidden p-4 sm:p-5 transition-all shadow-sm hover:shadow-md hover:border-[#EA8500]/50 ${className}`}
    >
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${getTopBarColor()}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#6B655B] mb-1">
            {title}
          </p>
          <h3 className="text-2xl font-bold text-[#1A1714] font-mono tracking-tight tabular-nums">
            {value}
          </h3>
        </div>
        <div className={`p-2.5 rounded-xl border flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
      </div>

      {(change || subtitle) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2.5 border-t border-[#EAE3D6]/80 text-[11px]">
          {change && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-mono font-semibold border ${getChangeColor()}`}
            >
              {change}
            </span>
          )}
          {subtitle && <span className="text-[#6B655B] font-medium">{subtitle}</span>}
        </div>
      )}
    </div>
  );
};
