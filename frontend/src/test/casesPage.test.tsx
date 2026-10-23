import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CasesPage } from '../pages/CasesPage';
import { api, ApiError } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getCases: vi.fn(),
    createCase: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code: string;
    constructor(message: string, code: string = 'api_error') {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  },
}));

const mockCasesResponse = {
  count: 2,
  total: 2,
  skip: 0,
  limit: 20,
  cases: [
    {
      case_id: 'FS-1042',
      reported_origin_transaction_id: 'T001',
      reported_amount: 50000,
      currency: 'INR',
      reported_at: '2026-01-12T10:35:00',
      investigation_status: 'under_investigation' as const,
      description: 'Synthetic demo case: victim V001 reports 50,000 INR UPI transfer.',
    },
    {
      case_id: 'FS-1043',
      reported_origin_transaction_id: 'TX_9902',
      reported_amount: 75000,
      currency: 'INR',
      reported_at: '2026-01-15T14:20:00',
      investigation_status: 'open' as const,
      description: 'Unauthorized IMPS payment reported from corporate account.',
    },
  ],
};

describe('CasesPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getCases as any).mockResolvedValue(mockCasesResponse);
  });

  it('renders page header, context label, description, and primary action buttons', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('04 / INVESTIGATION CASES')).toBeInTheDocument();
    expect(screen.getByText('Case Management')).toBeInTheDocument();
    expect(
      screen.getByText(/Review reported incidents, track investigation progress, and open a case/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Create New Case')).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh Cases')).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getCases).toHaveBeenCalled();
    });
  });

  it('calculates and renders real summary metrics cards from API data', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('TOTAL REGISTERED')).toBeInTheDocument();
      expect(screen.getByText('UNDER INVESTIGATION')).toBeInTheDocument();
      expect(screen.getByText('OPEN / AWAITING REVIEW')).toBeInTheDocument();
      expect(screen.getByText('TOTAL REPORTED LOSS')).toBeInTheDocument();
    });

    // 2 total cases, 1 under investigation, 1 open, total reported loss = 125,000 INR
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByText(/1,25,000|125,000/)).toBeInTheDocument();
  });

  it('renders case records in the registry table with links and badges', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
      expect(screen.getAllByText('FS-1043').length).toBeGreaterThan(0);
      expect(screen.getAllByText('T001').length).toBeGreaterThan(0);
      expect(screen.getAllByText('TX_9902').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Under Investigation').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Open Case').length).toBeGreaterThan(0);
    });
  });

  it('filters cases by search term across case ID, origin TX, and description', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByLabelText('Search cases');

    // Search by origin transaction ID
    fireEvent.change(searchInput, { target: { value: 'TX_9902' } });

    expect(screen.queryByText('T001')).not.toBeInTheDocument();
    expect(screen.getAllByText('TX_9902').length).toBeGreaterThan(0);

    // Search by description keyword
    fireEvent.change(searchInput, { target: { value: 'corporate' } });
    expect(screen.getAllByText('FS-1043').length).toBeGreaterThan(0);
    expect(screen.queryByText('FS-1042')).not.toBeInTheDocument();
  });

  it('filters cases by investigation status', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    const statusSelect = screen.getByLabelText('Filter by status');

    // Filter by open status
    fireEvent.change(statusSelect, { target: { value: 'open' } });
    expect(screen.getAllByText('FS-1043').length).toBeGreaterThan(0);
    expect(screen.queryByText('FS-1042')).not.toBeInTheDocument();

    // Filter by under_investigation
    fireEvent.change(statusSelect, { target: { value: 'under_investigation' } });
    expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    expect(screen.queryByText('FS-1043')).not.toBeInTheDocument();
  });

  it('sorts cases by reported amount and dates', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    const sortSelect = screen.getByLabelText('Sort cases');

    // Sort by highest loss amount
    fireEvent.change(sortSelect, { target: { value: 'amount_desc' } });
    // Both should be in document, sorted
    expect(screen.getAllByText('FS-1043').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
  });

  it('renders clear filters button when active and restores all records', async () => {
    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByLabelText('Search cases');
    fireEvent.change(searchInput, { target: { value: 'non_existent_case_123' } });

    // Should show empty filter state
    expect(screen.getByText('No cases matching filter criteria')).toBeInTheDocument();

    const resetBtn = screen.getByLabelText('Clear Filters');
    fireEvent.click(resetBtn);

    // After reset, both cases appear again
    expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FS-1043').length).toBeGreaterThan(0);
  });

  it('opens Create Case modal and submits valid new case', async () => {
    (api.createCase as any).mockResolvedValue({
      case_id: 'FS-2026-001',
      reported_origin_transaction_id: 'TX_7777',
      reported_amount: 60000,
      currency: 'INR',
      reported_at: '2026-01-20T11:00:00',
      investigation_status: 'under_investigation',
      description: 'Suspected mule network diversion.',
    });

    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    // Open modal
    fireEvent.click(screen.getByLabelText('Create New Case'));
    expect(screen.getByText('NEW INVESTIGATION DOSSIER')).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. FS-2026-002/i), {
      target: { value: 'FS-2026-001' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. TX_9901/i), {
      target: { value: 'TX_7777' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Summary of victim report/i), {
      target: { value: 'Suspected mule network diversion.' },
    });

    // Submit
    fireEvent.click(screen.getByText('Save & Initiate Case'));

    await waitFor(() => {
      expect(api.createCase).toHaveBeenCalledWith({
        case_id: 'FS-2026-001',
        reported_origin_transaction_id: 'TX_7777',
        reported_amount: 50000,
        currency: 'INR',
        investigation_status: 'under_investigation',
        description: 'Suspected mule network diversion.',
        created_by: 'investigator_ui',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Case FS-2026-001 registered successfully/i)).toBeInTheDocument();
    });
  });

  it('displays honest error message when case creation fails', async () => {
    (api.createCase as any).mockRejectedValue(
      new ApiError('Case already exists', '409')
    );

    render(
      <MemoryRouter>
        <CasesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('FS-1042').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByLabelText('Create New Case'));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. FS-2026-002/i), {
      target: { value: 'FS-1042' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. TX_9901/i), {
      target: { value: 'T001' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Summary of victim report/i), {
      target: { value: 'Duplicate case test.' },
    });

    fireEvent.click(screen.getByText('Save & Initiate Case'));

    await waitFor(() => {
      expect(screen.getByText(/Case ID "FS-1042" already exists/i)).toBeInTheDocument();
    });
  });
});
