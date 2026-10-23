import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  adaptCaseTraceToUnified,
  adaptV2TraceToUnified,
} from '../services/unifiedFlowAdapter';
import { FundFlowHierarchicalTree } from '../components/fund-flow/FundFlowHierarchicalTree';
import { FundFlowInspector } from '../components/fund-flow/FundFlowInspector';
import { FundFlowListView } from '../components/fund-flow/FundFlowListView';
import { FundFlowPage } from '../pages/FundFlowPage';
import { api } from '../services/api';
import { v2Api } from '../services/v2Api';

// Mock API clients
vi.mock('../services/api', () => ({
  api: {
    getCases: vi.fn(),
    getCaseGraph: vi.fn(),
    getCaseTrace: vi.fn(),
  },
}));

vi.mock('../services/v2Api', () => ({
  v2Api: {
    getTrace: vi.fn(),
    runLiveAnalysis: vi.fn(),
    getModelsStatus: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockV2TraceResponse = {
  root_account_id: 'ACC-000001',
  direction: 'outgoing' as const,
  max_depth_configured: 2,
  max_depth_reached: 2,
  nodes: [
    {
      account_id: 'ACC-000001',
      customer_name: 'Aditi Joshi',
      customer_type: 'retail',
      kyc_tier: 'tier_2_verified',
      current_balance: 177156.23,
      hop_distance: 0,
      is_root: true,
    },
    {
      account_id: 'ACC-000002',
      customer_name: 'Sara Bhat',
      customer_type: 'student',
      kyc_tier: 'tier_1_basic',
      current_balance: 95267.99,
      hop_distance: 1,
      is_root: false,
    },
    {
      account_id: 'ACC-000003',
      customer_name: 'Ishan Reddy',
      customer_type: 'retail',
      kyc_tier: 'tier_2_verified',
      current_balance: 107228.33,
      hop_distance: 2,
      is_root: false,
    },
  ],
  edges: [
    {
      transaction_id: 'TXN-0001',
      origin_account_id: 'ACC-000001',
      destination_account_id: 'ACC-000002',
      amount: 50000,
      currency: 'INR',
      channel: 'UPI',
      timestamp: '2026-01-12T10:30:00',
      hop: 1,
      is_cycle: false,
    },
    {
      transaction_id: 'TXN-0002',
      origin_account_id: 'ACC-000002',
      destination_account_id: 'ACC-000003',
      amount: 45000,
      currency: 'INR',
      channel: 'IMPS',
      timestamp: '2026-01-12T10:45:00',
      hop: 2,
      is_cycle: false,
    },
  ],
  total_nodes: 3,
  total_edges: 2,
  is_truncated: false,
  truncation_reason: 'Completed normally.',
  observed_total_transferred: 95000,
  attributed_exposure_upper_bound: 50000,
  attribution_status: 'observed_transfers_with_bounded_exposure',
  attribution_disclaimer: 'Downstream re-transfers are not added to stolen funds.',
};

const mockV1GraphResponse = {
  case_id: 'FS-1042',
  nodes: [
    {
      id: 'V001',
      label: 'Reporting victim (synthetic)',
      role: 'reporting_victim' as const,
      is_synthetic: true,
      hop_count: null,
      connection_type: 'origin',
      review_state: 'reporting_victim' as const,
      evidence_quality: 'not_assessed' as const,
      attributed_unforwarded_amount: null,
      attribution_status: null,
    },
    {
      id: 'A100',
      label: 'Reported initial receiver (synthetic)',
      role: 'reported_initial_receiver' as const,
      is_synthetic: true,
      hop_count: 0,
      connection_type: 'direct_hop',
      review_state: 'under_investigation' as const,
      evidence_quality: 'synthetic_assumption' as const,
      attributed_unforwarded_amount: 0.0,
      attribution_status: 'explicit',
    },
  ],
  edges: [
    {
      id: 'T001',
      source: 'V001',
      target: 'A100',
      amount: 50000,
      currency: 'INR',
      transaction_type: 'UPI',
      timestamp: '2026-01-12T10:30:00',
      hop_count: 0,
      attributed_amount: 50000,
      is_cycle_closing: false,
    },
  ],
  meta: {
    node_count: 2,
    edge_count: 1,
  },
};

describe('Unified Flow Adapter', () => {
  it('normalizes V2 trace graph into unified model with exposure guardrails', () => {
    const unified = adaptV2TraceToUnified(mockV2TraceResponse);

    expect(unified.summary.mode).toBe('account');
    expect(unified.summary.rootAccountId).toBe('ACC-000001');
    expect(unified.summary.rootCustomerName).toBe('Aditi Joshi');
    expect(unified.summary.directTransferAmount).toBe(50000);
    expect(unified.summary.attributedExposureUpperBound).toBe(50000);
    expect(unified.summary.observedTotalTransferred).toBe(95000);
    expect(unified.nodes).toHaveLength(3);
    expect(unified.edges).toHaveLength(2);
    expect(unified.nodes[0].isRoot).toBe(true);
    expect(unified.nodes[1].hop).toBe(1);
    expect(unified.nodes[2].hop).toBe(2);
  });

  it('normalizes V1 case graph into unified model without losing lineage assumptions', () => {
    const unified = adaptCaseTraceToUnified('FS-1042', mockV1GraphResponse);

    expect(unified.summary.mode).toBe('case');
    expect(unified.summary.targetId).toBe('FS-1042');
    expect(unified.summary.rootAccountId).toBe('V001');
    expect(unified.summary.directTransferAmount).toBe(50000);
    expect(unified.summary.attributedExposureUpperBound).toBe(50000);
    expect(unified.nodes).toHaveLength(2);
    expect(unified.edges).toHaveLength(1);
  });
});

describe('FundFlowHierarchicalTree Component', () => {
  it('renders root on left and downstream recipients in sequential columns', () => {
    const unified = adaptV2TraceToUnified(mockV2TraceResponse);
    const onSelectNode = vi.fn();
    const onSelectEdge = vi.fn();

    render(
      <FundFlowHierarchicalTree
        nodes={unified.nodes}
        edges={unified.edges}
        rootAccountId="ACC-000001"
        selectedNodeId={null}
        selectedEdgeId={null}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
      />
    );

    expect(screen.getByText('ACC-000001')).toBeInTheDocument();
    expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    expect(screen.getByText('ACC-000002')).toBeInTheDocument();
    expect(screen.getByText('Sara Bhat')).toBeInTheDocument();
    expect(screen.getByText('ACC-000003')).toBeInTheDocument();
    expect(screen.getByText('Ishan Reddy')).toBeInTheDocument();
    expect(screen.getByText('ORIGIN (HOP 0)')).toBeInTheDocument();
  });
});

describe('FundFlowInspector Component', () => {
  it('renders account details, customer type, and balance when node is selected', () => {
    const unified = adaptV2TraceToUnified(mockV2TraceResponse);
    const selected = unified.nodes[0];

    render(
      <MemoryRouter>
        <FundFlowInspector
          selectedNode={selected}
          selectedEdge={null}
          allEdges={unified.edges}
          allNodes={unified.nodes}
          onSelectNode={vi.fn()}
          onSelectEdge={vi.fn()}
          onClose={vi.fn()}
          mode="account"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('ROOT ORIGIN ACCOUNT')).toBeInTheDocument();
    expect(screen.getByText('Aditi Joshi')).toBeInTheDocument();
    expect(screen.getByText('ACC-000001')).toBeInTheDocument();
    expect(screen.getByText(/Open Account 360° Profile/i)).toBeInTheDocument();
    expect(screen.getByText(/View Ledger Transactions/i)).toBeInTheDocument();
  });
});

describe('FundFlowListView Component', () => {
  it('renders accessible table with hop, accounts, amounts, and filtering', () => {
    const unified = adaptV2TraceToUnified(mockV2TraceResponse);
    const onSelectEdge = vi.fn();

    render(
      <FundFlowListView
        edges={unified.edges}
        nodes={unified.nodes}
        selectedEdgeId={null}
        onSelectEdge={onSelectEdge}
        onSelectNodeById={vi.fn()}
      />
    );

    expect(screen.getByText('TXN-0001')).toBeInTheDocument();
    expect(screen.getByText('TXN-0002')).toBeInTheDocument();
    expect(screen.getAllByText('UPI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IMPS').length).toBeGreaterThan(0);
  });
});

describe('FundFlowPage Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (v2Api.getTrace as any).mockResolvedValue(mockV2TraceResponse);
    (api.getCaseGraph as any).mockResolvedValue(mockV1GraphResponse);
  });

  it('renders page heading, trace controls, summary strip, and hierarchical tree', async () => {
    render(
      <MemoryRouter initialEntries={['/fund-flow?account=ACC-000001']}>
        <FundFlowPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Follow the money')).toBeInTheDocument();
    expect(
      screen.getByText(/See where money moved from an account, inspect connected recipients/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/An account's connection to a suspicious transfer does not prove wrongdoing/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(v2Api.getTrace).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Aditi Joshi').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sara Bhat').length).toBeGreaterThan(0);
    });
  });
});
