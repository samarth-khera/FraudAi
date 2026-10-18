import React from 'react';
import { ShieldAlert, ShieldCheck, Clock, UserCheck, AlertTriangle } from 'lucide-react';

interface BadgeProps {
  variant?: 'status' | 'review' | 'role' | 'risk' | 'neutral';
  value: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', value, size = 'sm', className = '' }) => {
  const normalized = (value || '').toLowerCase().replace(/[\s-]/g, '_');

  let colorClasses = 'bg-[#F5F4F0] text-[#334155] border-[#D6D3CD]';
  let icon: React.ReactNode = null;
  let label = value;

  if (value.includes('_')) {
    label = value
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  if (variant === 'review' || variant === 'status') {
    switch (normalized) {
      case 'review_completed':
      case 'closed':
      case 'cleared':
      case 'verified':
        colorClasses = 'bg-emerald-50 text-emerald-800 border-emerald-300/90';
        icon = <ShieldCheck className="w-3 h-3 mr-1 text-emerald-700 flex-shrink-0" />;
        break;
      case 'under_review':
      case 'pending':
      case 'escalated_for_verification':
        colorClasses = 'bg-amber-50 text-amber-900 border-amber-300/90';
        icon = <Clock className="w-3 h-3 mr-1 text-amber-700 flex-shrink-0" />;
        break;
      case 'under_investigation':
      case 'open':
        colorClasses = 'bg-amber-50/90 text-amber-900 border-amber-300';
        icon = <AlertTriangle className="w-3 h-3 mr-1 text-amber-700 flex-shrink-0" />;
        break;
      case 'reporting_victim':
        colorClasses = 'bg-sky-50 text-sky-900 border-sky-300';
        icon = <UserCheck className="w-3 h-3 mr-1 text-sky-700 flex-shrink-0" />;
        break;
      default:
        colorClasses = 'bg-[#F5F4F0] text-[#475569] border-[#D6D3CD]';
        break;
    }
  } else if (variant === 'risk') {
    switch (normalized) {
      case 'high':
      case 'high_risk':
      case 'fraud_reported':
        colorClasses = 'bg-red-50 text-red-800 border-red-300';
        icon = <ShieldAlert className="w-3 h-3 mr-1 text-red-700 flex-shrink-0" />;
        break;
      case 'medium':
      case 'medium_risk':
      case 'suspicious':
        colorClasses = 'bg-amber-50 text-amber-900 border-amber-300';
        break;
      case 'low':
      case 'low_risk':
      case 'likely_innocent':
      case 'normal':
        colorClasses = 'bg-emerald-50 text-emerald-800 border-emerald-300';
        icon = <ShieldCheck className="w-3 h-3 mr-1 text-emerald-700 flex-shrink-0" />;
        break;
    }
  } else if (variant === 'role') {
    switch (normalized) {
      case 'reporting_victim':
        colorClasses = 'bg-sky-50 text-sky-900 border-sky-300';
        break;
      case 'reported_initial_receiver':
        colorClasses = 'bg-red-50 text-red-800 border-red-300';
        break;
      case 'intermediate_recipient':
        colorClasses = 'bg-teal-50 text-teal-900 border-teal-300';
        break;
      case 'recipient':
      case 'downstream_recipient':
        colorClasses = 'bg-[#F5F4F0] text-[#0B1322] border-[#CFCBC0]';
        break;
    }
  }

  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px] tracking-tight'
      : 'px-2.5 py-0.5 text-xs tracking-tight';

  return (
    <span
      className={`inline-flex items-center font-semibold rounded border ${colorClasses} ${sizeClasses} ${className}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};
