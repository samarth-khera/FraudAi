import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '../App';
import { UnifiedHeader } from '../components/layout/UnifiedHeader';
import { describeModelStatus } from '../lib/useModelStatus';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';
import { V2ModelStatusResponse } from '../types/v2';

const modelInfo = (available: boolean) => ({
  available,
  version: available ? 'v2-account-1.0.0' : null,
  model_type: null,
  features_count: null,
  trained_at: null,
  test_metrics: null,
  limitations: null,
});

const status = (over: Partial<V2ModelStatusResponse>): V2ModelStatusResponse => ({
  account_model: modelInfo(true),
  paysim_benchmark: modelInfo(true),
  overall_status: 'healthy',
  inference_ready: true,
  disclaimer: 'Advisory only',
  ...over,
});

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(v2Api, 'getModelsStatus').mockResolvedValue(status({}));
  vi.spyOn(api, 'getCases').mockResolvedValue({ count: 0, total: 0, skip: 0, limit: 100, cases: [] });
});

describe('Home page', () => {
  it('explains the product and offers the two starting actions', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Follow reported money/i);
    expect(screen.getByRole('link', { name: /Start sample investigation/i })).toHaveAttribute('href', '/cases/FS-2001');
    expect(screen.getByRole('link', { name: /Open investigations/i })).toHaveAttribute('href', '/cases');
    expect(screen.getByText(/is demonstration data/i)).toBeInTheDocument();
  });
});

describe('Main navigation', () => {
  it('has exactly Home, Investigations and Tools', () => {
    render(
      <MemoryRouter initialEntries={['/cases']}>
        <UnifiedHeader />
      </MemoryRouter>
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(links).toEqual(['Home', 'Investigations', 'Tools']);
    expect(screen.getByRole('link', { name: 'Investigations' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Tools active on advanced pages', () => {
    render(
      <MemoryRouter initialEntries={['/tools/model']}>
        <UnifiedHeader />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Model status indicator', () => {
  it('reports ready only when inference_ready is true', () => {
    expect(describeModelStatus(status({}), false).state).toBe('ready');
    // Artifacts present but not loadable: must not be shown as healthy.
    const broken = describeModelStatus(
      status({ inference_ready: false, overall_status: 'degraded_account_model_load_failed', status_detail: 'could not be loaded' }),
      false
    );
    expect(broken.state).toBe('unavailable');
    expect(broken.detail).toMatch(/could not be loaded/);
    expect(broken.detail).toMatch(/model assessments will not be shown/);
  });

  it('distinguishes an unreachable server from an unavailable model', () => {
    expect(describeModelStatus(null, true).state).toBe('server_unreachable');
    expect(describeModelStatus(null, false).state).toBe('checking');
  });

  it('shows the real reason in the header popover', async () => {
    vi.mocked(v2Api.getModelsStatus).mockResolvedValue(
      status({ inference_ready: false, overall_status: 'degraded_missing_account_model', status_detail: 'The account risk model file is missing on the server.' })
    );
    render(
      <MemoryRouter>
        <UnifiedHeader />
      </MemoryRouter>
    );
    const button = await screen.findByRole('button', { name: /Account model status: Model unavailable/i });
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveTextContent(/model file is missing/i);
    expect(screen.getByRole('link', { name: /Model performance details/i })).toHaveAttribute('href', '/tools/model');
  });

  it('shows server unreachable when the status request fails', async () => {
    vi.mocked(v2Api.getModelsStatus).mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      <MemoryRouter>
        <UnifiedHeader />
      </MemoryRouter>
    );
    expect(await screen.findByRole('button', { name: /Server unreachable/i })).toBeInTheDocument();
  });
});

describe('Legacy routes', () => {
  it.each([
    ['/guided-investigation', '/cases/FS-2001'],
    ['/demo', '/cases/FS-2001'],
    ['/app/dashboard', '/cases/FS-1042'],
    ['/app/cases/FS-1042', '/cases/FS-1042'],
    ['/insights', '/tools/model'],
    ['/app/model-insights', '/tools/model'],
    ['/audit?case_id=FS-1042', '/tools/audit?case_id=FS-1042'],
    ['/app/transaction-check', '/tools/transaction-model'],
    ['/fund-flow?mode=case&id=FS-1042', '/tools/fund-flow?mode=case&id=FS-1042'],
    ['/workspace', '/tools/accounts'],
    ['/v2/accounts/ACC-000003', '/tools/accounts/ACC-000003'],
    ['/accounts/ACC-000003', '/tools/accounts/ACC-000003'],
  ])('redirects %s to %s', (from, to) => {
    vi.spyOn(api, 'getCase').mockReturnValue(new Promise(() => {}));
    vi.spyOn(v2Api, 'getAccount').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'getGlobalAudit').mockReturnValue(new Promise(() => {}));
    renderAt(from);
    expect(screen.getByTestId('location')).toHaveTextContent(to);
  });

  it('shows a not-found page for unknown addresses', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { name: /Page not found/i })).toBeInTheDocument();
  });
});
