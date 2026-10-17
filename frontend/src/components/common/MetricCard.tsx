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
  iconBg = 'bg-indigo-50 text-indigo-600',
  subtitle,
  className = '',
}) => {
  const getChangeColor = () => {
    switch (changeType) {
      case 'positive':
        return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      case 'negative':
        return 'text-rose-600 bg-rose-50 border-rose-100';
      case 'warning':
        return 'text-amber-600 bg-amber-50 border-amber-100';
      default:
        return 'text-slate-600 bg-slate-100 border-slate-200';
    }
  };

  return (
    <div
      className={`glass-card glass-card-hover rounded-2xl p-5 relative overflow-hidden transition-all ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
            {title}
          </p>
          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{value}</h3>
        </div>
        <div className={`p-3 rounded-xl border border-white/60 shadow-sm ${iconBg}`}>
          {icon}
        </div>
      </div>

      {(change || subtitle) && (
        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-100/80 text-xs">
          {change && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold border ${getChangeColor()}`}
            >
              {change}
            </span>
          )}
          {subtitle && <span className="text-slate-500 font-medium">{subtitle}</span>}
        </div>
      )}
    </div>
  );
};
