import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../components/common/Badge';
import { MetricCard } from '../components/common/MetricCard';
import { Shield } from 'lucide-react';

describe('Common Components', () => {
  it('renders Badge with formatted label and variant styling', () => {
    const { rerender } = render(<Badge variant="status" value="under_investigation" />);
    expect(screen.getByText('Under Investigation')).toBeInTheDocument();

    rerender(<Badge variant="review" value="review_completed" />);
    expect(screen.getByText('Review Completed')).toBeInTheDocument();

    rerender(<Badge variant="risk" value="fraud_reported" />);
    expect(screen.getByText('Fraud Reported')).toBeInTheDocument();
  });

  it('renders MetricCard with title, value, change indicator, and subtitle', () => {
    render(
      <MetricCard
        title="Reported Exposure"
        value="₹50,000"
        change="+12.5%"
        changeType="warning"
        subtitle="Synthetic origin"
        icon={<Shield data-testid="test-icon" />}
      />
    );

    expect(screen.getByText('Reported Exposure')).toBeInTheDocument();
    expect(screen.getByText('₹50,000')).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toBeInTheDocument();
    expect(screen.getByText('Synthetic origin')).toBeInTheDocument();
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });
});
