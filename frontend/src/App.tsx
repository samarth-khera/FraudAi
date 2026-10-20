import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionCheckPage } from './pages/TransactionCheckPage';
import { FundFlowPage } from './pages/FundFlowPage';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { ModelInsightsPage } from './pages/ModelInsightsPage';
import { V2SearchPage } from './pages/v2/V2SearchPage';
import { V2AccountDetailPage } from './pages/v2/V2AccountDetailPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Marketing Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* V2 Forensic Investigation Workspace */}
        <Route path="/v2" element={<V2SearchPage />} />
        <Route path="/v2/accounts/:accountId" element={<V2AccountDetailPage />} />

        {/* Investigation Application Workspace (V1) */}
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="transaction-check" element={<TransactionCheckPage />} />
          <Route path="fund-flow" element={<FundFlowPage />} />
          <Route path="cases" element={<CasesPage />} />
          <Route path="cases/:caseId" element={<CaseDetailPage />} />
          <Route path="model-insights" element={<ModelInsightsPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
