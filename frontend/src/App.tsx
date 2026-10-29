import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, Link } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { HomePage, SAMPLE_CASE_ID } from './pages/HomePage';
import { InvestigationsPage } from './pages/InvestigationsPage';
import { CaseWorkspacePage } from './pages/CaseWorkspacePage';
import { ToolsPage } from './pages/ToolsPage';
import { InvestigatePage } from './pages/InvestigatePage';
import { LoadingState } from './components/ui/StateViews';

// Tools pages carry the heavy charting/graph libraries (cytoscape, recharts); load them on demand
// so the main investigation journey does not download them.
const TransactionCheckPage = lazy(() => import('./pages/TransactionCheckPage').then((m) => ({ default: m.TransactionCheckPage })));
const FundFlowPage = lazy(() => import('./pages/FundFlowPage').then((m) => ({ default: m.FundFlowPage })));
const ModelInsightsPage = lazy(() => import('./pages/ModelInsightsPage').then((m) => ({ default: m.ModelInsightsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const V2SearchPage = lazy(() => import('./pages/v2/V2SearchPage').then((m) => ({ default: m.V2SearchPage })));
const V2AccountDetailPage = lazy(() => import('./pages/v2/V2AccountDetailPage').then((m) => ({ default: m.V2AccountDetailPage })));

class ChunkErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="max-w-xl space-y-3 py-10 px-4 mx-auto">
        <h1 className="font-display text-xl font-bold">This page could not be loaded</h1>
        <p className="text-sm text-[#6B655B]">Part of the application failed to download. Reload the page to try again.</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

const Lazy: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChunkErrorBoundary>
    <Suspense fallback={<LoadingState label="Loading…" />}>{children}</Suspense>
  </ChunkErrorBoundary>
);

/** Redirect that keeps the query string, so old bookmarks such as /audit?case_id=X keep their filters. */
const Redirect: React.FC<{ to: string | ((params: Record<string, string | undefined>) => string) }> = ({ to }) => {
  const location = useLocation();
  const params = useParams();
  const pathname = typeof to === 'function' ? to(params) : to;
  return <Navigate to={{ pathname, search: location.search }} replace />;
};

const NotFoundPage: React.FC = () => (
  <div className="max-w-xl space-y-4 py-10">
    <h1 className="font-display text-2xl font-extrabold">Page not found</h1>
    <p className="text-sm text-[#6B655B]">There is no page at this address.</p>
    <div className="flex gap-3">
      <Link to="/" className="btn-primary">Home</Link>
      <Link to="/cases" className="btn-secondary">Investigations</Link>
    </div>
  </div>
);

const enc = (v: string | undefined) => encodeURIComponent(v ?? '');

export const AppRoutes: React.FC = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/investigate" element={<InvestigatePage />} />
      <Route path="/cases" element={<InvestigationsPage />} />
      <Route path="/cases/:caseId" element={<CaseWorkspacePage />} />
      <Route path="/tools" element={<ToolsPage />} />
      <Route path="/tools/model" element={<Lazy><ModelInsightsPage /></Lazy>} />
      <Route path="/tools/audit" element={<Lazy><AuditPage /></Lazy>} />
      <Route path="/tools/fund-flow" element={<Lazy><FundFlowPage /></Lazy>} />
      <Route path="/tools/transaction-model" element={<Lazy><TransactionCheckPage /></Lazy>} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>

    {/* Account lookup pages render their own header and footer. */}
    <Route path="/tools/accounts" element={<Lazy><V2SearchPage /></Lazy>} />
    <Route path="/tools/accounts/:accountId" element={<Lazy><V2AccountDetailPage /></Lazy>} />

    {/* Legacy routes kept as redirects. */}
    <Route path="/guided-investigation" element={<Redirect to={`/cases/${SAMPLE_CASE_ID}`} />} />
    <Route path="/demo" element={<Redirect to={`/cases/${SAMPLE_CASE_ID}`} />} />
    <Route path="/app" element={<Redirect to="/cases" />} />
    <Route path="/app/dashboard" element={<Redirect to="/cases/FS-1042" />} />
    <Route path="/app/cases" element={<Redirect to="/cases" />} />
    <Route path="/app/cases/:caseId" element={<Redirect to={(p) => `/cases/${enc(p.caseId)}`} />} />
    <Route path="/app/fund-flow" element={<Redirect to="/tools/fund-flow" />} />
    <Route path="/fund-flow" element={<Redirect to="/tools/fund-flow" />} />
    <Route path="/app/transaction-check" element={<Redirect to="/tools/transaction-model" />} />
    <Route path="/app/model-insights" element={<Redirect to="/tools/model" />} />
    <Route path="/insights" element={<Redirect to="/tools/model" />} />
    <Route path="/app/audit" element={<Redirect to="/tools/audit" />} />
    <Route path="/audit" element={<Redirect to="/tools/audit" />} />
    <Route path="/workspace" element={<Redirect to="/tools/accounts" />} />
    <Route path="/v2" element={<Redirect to="/tools/accounts" />} />
    <Route path="/accounts/:accountId" element={<Redirect to={(p) => `/tools/accounts/${enc(p.accountId)}`} />} />
    <Route path="/v2/accounts/:accountId" element={<Redirect to={(p) => `/tools/accounts/${enc(p.accountId)}`} />} />
  </Routes>
);

export const App: React.FC = () => (
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
);

export default App;
