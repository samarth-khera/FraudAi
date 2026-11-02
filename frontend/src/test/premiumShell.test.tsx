import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { routeMeta } from '../components/layout/navigation';
import { setSidebarCollapsed } from '../components/layout/sidebarState';
import { EvidenceTag } from '../components/ui/EvidenceTag';
import { startRevealSystem } from '../lib/motion';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';
import { FraudCase, GlobalAuditResponse } from '../types/api';
import { DatasetSummary } from '../types/dynamic';
import { DataSourceInfo } from '../types/investigation';
import { V2ModelStatusResponse } from '../types/v2';

const modelStatus: V2ModelStatusResponse = {
  account_model: { available: true, version: 'v2-account-2.0.0', model_type: null, features_count: null, trained_at: null, test_metrics: null, limitations: null },
  paysim_benchmark: { available: true, version: 'v2-benchmark-1.0.0', model_type: null, features_count: null, trained_at: null, test_metrics: null, limitations: null },
  overall_status: 'healthy',
  inference_ready: true,
  disclaimer: 'Advisory only',
  investigation_models: {
    used_by: 'Investigate page',
    ready: true,
    transaction_model: { available: true, purpose: 'p', model_version: 'v3-transaction-1.0.0', held_out_evaluation: { recall: 0.9391, precision: 0.6893 } },
    account_model: { available: true, purpose: 'p', model_version: 'v3-account-1.0.0', held_out_evaluation: { recall: 0.8215, precision: 0.4665 } },
    datasets: [],
  },
};

const kase = (over: Partial<FraudCase>): FraudCase =>
  ({
    case_id: 'FS-2001',
    description: 'Sample complaint.',
    investigation_status: 'open',
    reported_amount: 250000,
    currency: 'INR',
    reported_at: '2026-01-16T11:40:00',
    updated_at: '2026-11-02T04:18:10',
    account_dataset: 'v2_synthetic_ledger',
    review_progress: { decisions_recorded: 0 },
    ...over,
  }) as FraudCase;

const audit: GlobalAuditResponse = {
  total_count: 2,
  filtered_count: 2,
  skip: 0,
  limit: 6,
  events: [
    { event_id: 2, case_id: 'FS-2001', timestamp: '2026-11-02T04:18:10', action: 'case_created', performed_by: 'system_seeder', entity_type: 'case', entity_id: 'FS-2001' },
  ],
  summary: {
    total_events: 2,
    review_decisions_count: 0,
    case_status_changes_count: 2,
    trace_events_count: 0,
    most_recent_timestamp: '2026-11-02T04:18:10',
    earliest_timestamp: '2026-11-02T04:18:10',
    distinct_cases_count: 2,
    distinct_actors_count: 1,
  },
  integrity_status: {
    storage_backend: 'SQLite',
    append_only_enforced: true,
    cryptographic_signatures: false,
    server_timestamps: true,
    last_verified_at: '2026-11-02T05:45:31',
    integrity_disclosure: 'x',
  },
};

const datasets = [
  { dataset_id: 'demo-ledger', title: 'FraudShield demo ledger', description: 'd', available: true, model_support: 'unsupported_distribution_shift', source: { accounts_count: 10000, transactions_count: 353393 } },
  { dataset_id: 'forensic-scenarios', title: 'Forensic scenario ledger', description: 'd', available: true, model_support: 'validated_in_distribution', source: { accounts_count: 2676, transactions_count: 88623 } },
] as unknown as DatasetSummary[];

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setSidebarCollapsed(false);
  vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValue(modelStatus);
  vi.spyOn(api, 'getCases').mockResolvedValue({ count: 2, total: 2, skip: 0, limit: 100, cases: [kase({}), kase({ case_id: 'FS-1042', investigation_status: 'under_investigation', reported_amount: 50000, account_dataset: 'case_ledger' })] });
  vi.spyOn(api, 'getGlobalAudit').mockResolvedValue(audit);
  vi.spyOn(v2Api, 'listDatasets').mockResolvedValue(datasets);
  vi.spyOn(v2Api, 'getDataSource').mockResolvedValue({ is_synthetic: true, real_bank_data: false, data_as_of: '2026-03-31T23:58:38', snapshot_built_at: '2026-10-20T13:56:07Z', database_backend: 'sqlite' } as DataSourceInfo);
});

describe('Route titles and breadcrumbs', () => {
  it('names every page and keeps identifiers in the trail', () => {
    const at = (path: string) => {
      const [p, q = ''] = path.split('?');
      return routeMeta(p, new URLSearchParams(q));
    };
    expect(at('/')).toMatchObject({ title: 'Overview', crumbs: [{ label: 'Workspace' }, { label: 'Overview' }] });
    expect(at('/investigate?account=FS-7B7C13AB&dataset=forensic-scenarios')).toMatchObject({
      title: 'FS-7B7C13AB – Investigate',
      dataset: 'Synthetic forensic scenario ledger',
      crumbs: [{ label: 'Investigate', to: '/investigate?dataset=forensic-scenarios' }, { label: 'FS-7B7C13AB', mono: true }],
    });
    expect(at('/cases/FS-2001').crumbs).toEqual([{ label: 'Cases', to: '/cases' }, { label: 'FS-2001', mono: true }]);
    expect(at('/tools/model').crumbs).toEqual([{ label: 'Reference', to: '/tools' }, { label: 'Model performance' }]);
    expect(at('/tools/accounts/ACC-000001').title).toBe('ACC-000001 – Accounts');
    expect(at('/nowhere').title).toBe('Page not found');
  });

  it('sets the document title and shows the breadcrumb for the page', async () => {
    render(
      <MemoryRouter initialEntries={['/cases']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.title).toBe('Cases – FraudShield AI'));
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0];
    expect(within(crumbs).getByText('Cases')).toHaveAttribute('aria-current', 'page');
  });
});

describe('Sidebar and small-screen menu', () => {
  it('folds the sidebar to icons, keeps every destination named, and remembers the choice', () => {
    render(
      <MemoryRouter initialEntries={['/cases']}>
        <UnifiedHeader />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem('fraudshield.sidebar')).toBe('collapsed');
    // Folded links keep their accessible names (shown as tooltips), and the active page is still marked.
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Cases' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(expand);
    expect(window.localStorage.getItem('fraudshield.sidebar')).toBe('expanded');
  });

  it('closes the menu with Escape and returns focus to the menu button', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <UnifiedHeader />
      </MemoryRouter>,
    );
    const open = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(open);
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
    expect(open).toHaveFocus();
  });
});

describe('Motion stays out of the way', () => {
  it('never hides content when motion is unavailable or reduced', () => {
    const root = document.createElement('div');
    root.innerHTML = '<section data-reveal>One</section><section data-reveal="fade">Two</section>';
    document.body.appendChild(root);
    const stop = startRevealSystem(root);
    root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
      expect(el.style.opacity).toBe('');
      expect(el.style.transform).toBe('');
    });
    stop();

    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      const stopReduced = startRevealSystem(root);
      root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => expect(el.style.opacity).toBe(''));
      stopReduced();
    } finally {
      window.matchMedia = original;
      root.remove();
    }
  });
});

describe('Evidence labels', () => {
  it('names each kind of statement in words, not only colour', () => {
    render(
      <>
        <EvidenceTag kind="observed" />
        <EvidenceTag kind="model" />
        <EvidenceTag kind="interpretation" />
        <EvidenceTag kind="missing" />
      </>,
    );
    expect(screen.getByText('Recorded fact')).toHaveAttribute('data-evidence-kind', 'observed');
    expect(screen.getByText('Model output')).toHaveAttribute('data-evidence-kind', 'model');
    expect(screen.getByText('Possible interpretation')).toHaveAttribute('title', expect.stringMatching(/Other explanations may fit/));
    expect(screen.getByText('Not known')).toBeInTheDocument();
  });
});

describe('Overview dashboard', () => {
  it('shows only figures the API returned, with their context', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const figures = await screen.findByRole('region', { name: 'Key figures' });
    await waitFor(() => expect(within(figures).getByText('1 under investigation')).toBeInTheDocument());
    expect(within(figures).getByText('₹3,00,000')).toBeInTheDocument();
    expect(within(figures).getByText(/As reported by the complainants, 2 cases/)).toBeInTheDocument();
    expect(within(figures).getByText('Review decisions recorded').closest('div')).toHaveTextContent('0');

    // Each ledger keeps its own model validation status.
    expect(await screen.findByText('Models validated here')).toBeInTheDocument();
    expect(screen.getByText('Models reference only')).toBeInTheDocument();
    // Held-out results are labelled as such, next to the model version.
    expect(await screen.findByText('v3-transaction-1.0.0')).toBeInTheDocument();
    expect(screen.getByText('93.9%')).toBeInTheDocument();
    // Activity comes from the audit log; the demo seeder is not shown as a person.
    expect(screen.getByText('Case created')).toBeInTheDocument();
    expect(screen.getByText('By the system (demo setup)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open investigations/ })).toHaveAttribute('href', '/cases');
  });

  it('says what could not load instead of showing invented numbers', async () => {
    vi.mocked(api.getCases).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.getGlobalAudit).mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const figures = await screen.findByRole('region', { name: 'Key figures' });
    await waitFor(() => expect(within(figures).getAllByText('Unavailable')).toHaveLength(4));
    expect(screen.getByText(/Cases could not be loaded/)).toBeInTheDocument();
  });
});

afterEach(() => {
  document.title = '';
});

describe('Quiet retry for dropped connections', () => {
  it('reads again once when the connection drops, but not on an HTTP error or after an abort', async () => {
    const { retryRead } = await import('../lib/retry');
    const dropped = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce('ok');
    await expect(retryRead(dropped, undefined, 0)).resolves.toBe('ok');
    expect(dropped).toHaveBeenCalledTimes(2);

    const httpError = Object.assign(new Error('Not found'), { status: 404, code: 'account_not_found' });
    const answered = vi.fn().mockRejectedValue(httpError);
    await expect(retryRead(answered, undefined, 0)).rejects.toBe(httpError);
    expect(answered).toHaveBeenCalledTimes(1);

    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(retryRead(down, undefined, 0)).rejects.toBeInstanceOf(TypeError);
    expect(down).toHaveBeenCalledTimes(2);

    const c = new AbortController();
    c.abort();
    const aborted = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(retryRead(aborted, c.signal, 0)).rejects.toBeInstanceOf(TypeError);
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
