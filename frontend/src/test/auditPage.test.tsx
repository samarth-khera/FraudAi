import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuditPage } from '../pages/AuditPage';
import { api } from '../services/api';
import { GlobalAuditResponse } from '../types/api';

const mockAuditResponse: GlobalAuditResponse = {
  total_count: 3,
  filtered_count: 3,
  skip: 0,
  limit: 25,
  events: [
    {
      event_id: 1045,
      case_id: 'FS-1042',
      timestamp: '2026-10-23T13:51:27.280507Z',
      action: 'account_review_recorded',
      performed_by: 'investigator_ui',
      entity_type: 'account_review',
      entity_id: 'FS-1042:ACC-000001',
      details: {
        account_id: 'ACC-000001',
        old_review_state: 'not_reviewed',
        new_review_state: 'confirmed_mule',
        evidence_quality: 'high',
        notes: 'Rapid pass-through of funds with immediate fan-out to Layer-2 mule accounts.',
        decision_reasons: ['Rapid pass-through pattern', 'High fan-out ratio'],
        supporting_transaction_ids: ['TX-001', 'TX-002'],
        additional_info_needed: false,
      },
    },
    {
      event_id: 1044,
      case_id: 'FS-1042',
      timestamp: '2026-10-23T13:50:00.000000Z',
      action: 'trace_paths_persisted',
      performed_by: 'tracer_service',
      entity_type: 'trace_paths',
      entity_id: 'FS-1042',
      details: {
        path_count: 3,
      },
    },
    {
      event_id: 1043,
      case_id: 'FS-1042',
      timestamp: '2026-10-23T12:00:00.000000Z',
      action: 'case_metadata_updated',
      performed_by: 'investigator_ui',
      entity_type: 'case',
      entity_id: 'FS-1042',
      details: {
        investigation_status: {
          old: 'open',
          new: 'under_investigation',
        },
      },
    },
  ],
  summary: {
    total_events: 1045,
    review_decisions_count: 2,
    case_status_changes_count: 1,
    trace_events_count: 1042,
    most_recent_timestamp: '2026-10-23T13:51:27.280507Z',
    earliest_timestamp: '2026-10-20T10:00:00.000000Z',
    distinct_cases_count: 1,
    distinct_actors_count: 3,
  },
  integrity_status: {
    storage_backend: 'SQLite Relational (audit_events)',
    append_only_enforced: true,
    cryptographic_signatures: false,
    server_timestamps: true,
    last_verified_at: '2026-10-23T14:00:00.000000Z',
    integrity_disclosure:
      'Application-enforced append-only audit trail in SQLite. Server-generated UTC timestamps.',
  },
};

describe('AuditPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'getGlobalAudit').mockResolvedValue(mockAuditResponse);
  });

  it('renders header, status indicators, and summary metrics cards', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Audit & Governance')).toBeInTheDocument();
    expect(screen.getByText('GOVERNANCE & PROVENANCE')).toBeInTheDocument();
    expect(screen.getByText(/Storage: Healthy \(audit_events\)/i)).toBeInTheDocument();
    expect(screen.getByText('Append-Only Enforced')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('1,045')).toBeInTheDocument(); // total events
      expect(screen.getByText('2')).toBeInTheDocument(); // human reviews count
      expect(screen.getByText('1,042')).toBeInTheDocument(); // trace events count
    });
  });

  it('renders recorded audit events in timeline table', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('#1045')).toBeInTheDocument();
      expect(screen.getByText('#1044')).toBeInTheDocument();
      expect(screen.getByText('#1043')).toBeInTheDocument();
      expect(screen.getByText('Review Recorded')).toBeInTheDocument();
      expect(screen.getByText('Trace Persisted')).toBeInTheDocument();
      expect(screen.getByText('Status Updated')).toBeInTheDocument();
    });

    expect(screen.getByText('ACC-000001')).toBeInTheDocument();
    expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    expect(screen.getAllByText('investigator_ui').length).toBeGreaterThan(0);
  });

  it('filters by category when category tab is clicked', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Human Reviews' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Human Reviews' }));

    await waitFor(() => {
      expect(api.getGlobalAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'reviews',
        })
      );
    });
  });

  it('searches across events and triggers filtered API query', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search across Case ID/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search across Case ID/i);
    fireEvent.change(searchInput, { target: { value: 'ACC-000001' } });

    await waitFor(() => {
      expect(api.getGlobalAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'ACC-000001',
        })
      );
    });
  });

  it('opens slide-over Event Detail Drawer when an event is clicked', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('#1045')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('#1045'));

    await waitFor(() => {
      expect(screen.getByText('EVENT #1045')).toBeInTheDocument();
      expect(screen.getByText('ACCOUNT REVIEW RECORDED')).toBeInTheDocument();
      expect(screen.getByText(/Rapid pass-through of funds/i)).toBeInTheDocument();
      expect(screen.getByText('Open Case Dossier')).toBeInTheDocument();
      expect(screen.getByText('360° Profile')).toBeInTheDocument();
      expect(screen.getByText('Close Inspector')).toBeInTheDocument();
    });

    // Close drawer
    fireEvent.click(screen.getByText('Close Inspector'));
    await waitFor(() => {
      expect(screen.queryByText('EVENT #1045')).not.toBeInTheDocument();
    });
  });

  it('handles reset all filters action', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search across Case ID/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search across Case ID/i);
    fireEvent.change(searchInput, { target: { value: 'mule' } });

    await waitFor(() => {
      expect(screen.getByText('Reset All Filters')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reset All Filters'));

    await waitFor(() => {
      expect(screen.queryByText('Reset All Filters')).not.toBeInTheDocument();
    });
  });

  it('renders audit integrity disclosures card', async () => {
    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Audit Architecture & Integrity Disclosures')).toBeInTheDocument();
      expect(screen.getByText('Persistence Architecture')).toBeInTheDocument();
      expect(screen.getByText('Append-Only Application Model')).toBeInTheDocument();
      expect(screen.getByText(/Cryptographic Limitations Note/i)).toBeInTheDocument();
    });
  });

  it('handles empty state when no events match filter', async () => {
    vi.spyOn(api, 'getGlobalAudit').mockResolvedValueOnce({
      ...mockAuditResponse,
      total_count: 0,
      filtered_count: 0,
      events: [],
    });

    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No audit events found')).toBeInTheDocument();
    });
  });

  it('handles API error state gracefully', async () => {
    vi.spyOn(api, 'getGlobalAudit').mockRejectedValueOnce(new Error('Network connection failed'));

    render(
      <MemoryRouter>
        <AuditPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Network connection failed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });
});
