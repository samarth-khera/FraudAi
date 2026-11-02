import {
  BarChart3,
  Calculator,
  FileSearch,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  ScanSearch,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  hint: string;
  matches: (pathname: string) => boolean;
}

const starts = (p: string, prefixes: string[]) => prefixes.some((t) => p === t || p.startsWith(`${t}/`));

/** The work an investigator does, in the order they usually do it. */
export const NAV_ITEMS: NavItem[] = [
  { name: 'Overview', path: '/', icon: LayoutDashboard, hint: 'Ledger, models and open work', matches: (p) => p === '/' },
  { name: 'Investigate', path: '/investigate', icon: ScanSearch, hint: 'Follow an account’s money', matches: (p) => p.startsWith('/investigate') },
  { name: 'Accounts', path: '/tools/accounts', icon: Users, hint: 'Look up any ledger account', matches: (p) => starts(p, ['/tools/accounts', '/accounts', '/v2', '/workspace']) },
  { name: 'Cases', path: '/cases', icon: FolderOpen, hint: 'Saved cases and review history', matches: (p) => starts(p, ['/cases', '/app/cases']) },
];

/** Technical views for checking the models and raw records; not needed to work a case. */
export const REFERENCE_ITEMS: NavItem[] = [
  { name: 'Fund-flow explorer', path: '/tools/fund-flow', icon: GitBranch, hint: 'Trace any account with custom filters', matches: (p) => starts(p, ['/tools/fund-flow', '/fund-flow', '/app/fund-flow']) },
  { name: 'Model performance', path: '/tools/model', icon: BarChart3, hint: 'How the models were tested', matches: (p) => starts(p, ['/tools/model', '/insights', '/app/model-insights']) },
  { name: 'Audit log', path: '/tools/audit', icon: FileSearch, hint: 'Every recorded event', matches: (p) => starts(p, ['/tools/audit', '/audit', '/app/audit']) },
  { name: 'Transaction model check', path: '/tools/transaction-model', icon: Calculator, hint: 'Score one PaySim transaction', matches: (p) => starts(p, ['/tools/transaction-model', '/app/transaction-check']) },
];

export interface Crumb {
  label: string;
  to?: string;
  /** Identifiers (account and case IDs) are set in the monospace face. */
  mono?: boolean;
}

export interface RouteMeta {
  /** For the document title. */
  title: string;
  crumbs: Crumb[];
  /** Which synthetic dataset the page is working in, when that matters. */
  dataset?: string;
}

const DATASET_LABEL: Record<string, string> = {
  'demo-ledger': 'Synthetic demo ledger',
  'forensic-scenarios': 'Synthetic forensic scenario ledger',
};

const REFERENCE_TITLES: Record<string, string> = {
  '/tools/model': 'Model performance',
  '/tools/audit': 'Audit log',
  '/tools/fund-flow': 'Fund-flow explorer',
  '/tools/transaction-model': 'Transaction model check',
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Page title, breadcrumb trail and dataset context for a location. Pure, so it is easy to test. */
export function routeMeta(pathname: string, search: URLSearchParams): RouteMeta {
  const p = pathname.replace(/\/+$/, '') || '/';
  const W: Crumb = { label: 'Workspace' };
  if (p === '/') return { title: 'Overview', crumbs: [W, { label: 'Overview' }] };

  if (p === '/investigate') {
    const dataset = search.get('dataset') === 'forensic-scenarios' ? 'forensic-scenarios' : 'demo-ledger';
    const account = search.get('account')?.trim();
    const base = { dataset: DATASET_LABEL[dataset] };
    if (!account) return { ...base, title: 'Investigate', crumbs: [W, { label: 'Investigate' }] };
    return {
      ...base,
      title: `${account} – Investigate`,
      crumbs: [{ label: 'Investigate', to: dataset === 'demo-ledger' ? '/investigate' : `/investigate?dataset=${dataset}` }, { label: account, mono: true }],
    };
  }

  if (p === '/cases') return { title: 'Cases', crumbs: [W, { label: 'Cases' }] };
  const caseMatch = p.match(/^\/cases\/([^/]+)$/);
  if (caseMatch) {
    const id = decode(caseMatch[1]);
    return { title: `${id} – Cases`, crumbs: [{ label: 'Cases', to: '/cases' }, { label: id, mono: true }] };
  }

  if (p === '/tools/accounts') return { title: 'Accounts', crumbs: [W, { label: 'Accounts' }] };
  const accountMatch = p.match(/^\/tools\/accounts\/([^/]+)$/);
  if (accountMatch) {
    const id = decode(accountMatch[1]);
    return { title: `${id} – Accounts`, crumbs: [{ label: 'Accounts', to: '/tools/accounts' }, { label: id, mono: true }] };
  }

  if (p === '/tools') return { title: 'Reference tools', crumbs: [{ label: 'Reference' }, { label: 'Reference tools' }] };
  if (REFERENCE_TITLES[p]) return { title: REFERENCE_TITLES[p], crumbs: [{ label: 'Reference', to: '/tools' }, { label: REFERENCE_TITLES[p] }] };

  return { title: 'Page not found', crumbs: [{ label: 'Page not found' }] };
}
