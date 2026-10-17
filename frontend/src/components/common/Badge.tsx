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

  let colorClasses = 'bg-slate-100 text-slate-700 border-slate-200';
  let icon: React.ReactNode = null;
  let label = value;

  // Format label for display
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
        colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
        icon = <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />;
        break;
      case 'under_review':
      case 'pending':
        colorClasses = 'bg-amber-50 text-amber-700 border-amber-200/80';
        icon = <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />;
        break;
      case 'under_investigation':
      case 'open':
        colorClasses = 'bg-indigo-50 text-indigo-700 border-indigo-200/80';
        icon = <AlertTriangle className="w-3.5 h-3.5 mr-1 text-indigo-600" />;
        break;
      case 'reporting_victim':
        colorClasses = 'bg-sky-50 text-sky-700 border-sky-200/80';
        icon = <UserCheck className="w-3.5 h-3.5 mr-1 text-sky-600" />;
        break;
      default:
        colorClasses = 'bg-slate-100 text-slate-600 border-slate-200';
        break;
    }
  } else if (variant === 'risk') {
    switch (normalized) {
      case 'high':
      case 'high_risk':
      case 'fraud_reported':
        colorClasses = 'bg-rose-50 text-rose-700 border-rose-200/80';
        icon = <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-600" />;
        break;
      case 'medium':
      case 'medium_risk':
      case 'suspicious':
        colorClasses = 'bg-amber-50 text-amber-700 border-amber-200/80';
        break;
      case 'low':
      case 'low_risk':
      case 'likely_innocent':
      case 'normal':
        colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
        icon = <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-600" />;
        break;
    }
  } else if (variant === 'role') {
    switch (normalized) {
      case 'reporting_victim':
        colorClasses = 'bg-blue-50 text-blue-700 border-blue-200/80';
        break;
      case 'reported_initial_receiver':
        colorClasses = 'bg-amber-50 text-amber-800 border-amber-200/80';
        break;
      case 'intermediate_recipient':
        colorClasses = 'bg-purple-50 text-purple-700 border-purple-200/80';
        break;
      case 'recipient':
        colorClasses = 'bg-indigo-50 text-indigo-700 border-indigo-200/80';
        break;
    }
  }

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${colorClasses} ${sizeClasses} ${className}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};
