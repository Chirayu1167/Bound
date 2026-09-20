/**
 * Bound — Demo app catalog (frontend presentation only).
 *
 * These are SIMULATED integrations for the demo: there is no OAuth, no real
 * Swiggy/Amazon/Uber/IndiGo/MakeMyTrip API behind them. Every card is labeled
 * "Demo Integration" in the UI.
 *
 * "Connected" is derived from REAL backend state: an app counts as connected
 * when at least one ACTIVE mandate (on an ACTIVE, non-task agent) covers one
 * of the app's merchant categories. Connecting an app creates a REAL mandate
 * via POST /mandates — the existing authorization model does the rest.
 */

import type { AgentNode, MandateItem } from './types';

export interface DemoAppDef {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  /** Backend merchant_category values this app can be used for. */
  categories: string[];
}

export const DEMO_APPS: DemoAppDef[] = [
  { id: 'swiggy', name: 'Swiggy', tagline: 'Food delivery', icon: '🍔', categories: ['Dining', 'Grocery'] },
  { id: 'amazon', name: 'Amazon', tagline: 'Online shopping', icon: '📦', categories: ['General', 'Electronics', 'Apparel'] },
  { id: 'uber', name: 'Uber', tagline: 'Rides', icon: '🚕', categories: ['Transport'] },
  { id: 'indigo', name: 'IndiGo', tagline: 'Flights', icon: '✈️', categories: ['Airlines'] },
  { id: 'makemytrip', name: 'MakeMyTrip', tagline: 'Flights & hotels', icon: '🧳', categories: ['Airlines', 'Hotels'] },
];

export interface AppConnection {
  app: DemoAppDef;
  /** ACTIVE mandates (on ACTIVE user agents) covering this app's categories. */
  mandates: MandateItem[];
  agentNames: string[];
}

export function connectionsForApps(
  apps: DemoAppDef[],
  mandates: MandateItem[],
  agents: AgentNode[]
): AppConnection[] {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  return apps.map((app) => {
    const mandatesForApp = mandates.filter((m) => {
      if (m.status !== 'ACTIVE') return false;
      if (!app.categories.includes(m.merchant_category)) return false;
      const agent = agentById.get(m.agent_id);
      if (!agent || agent.status !== 'ACTIVE' || agent.is_task_agent) return false;
      return true;
    });
    const agentNames = [...new Set(mandatesForApp.map((m) => m.agentName))];
    return { app, mandates: mandatesForApp, agentNames };
  });
}

/** Apps a given agent can use, from its ACTIVE mandates' categories. */
export function appsForAgent(agentId: string, mandates: MandateItem[]): DemoAppDef[] {
  const cats = new Set(
    mandates.filter((m) => m.agent_id === agentId && m.status === 'ACTIVE').map((m) => m.merchant_category)
  );
  if (cats.size === 0) return [];
  return DEMO_APPS.filter((app) => app.categories.some((c) => cats.has(c)));
}
