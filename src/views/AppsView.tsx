/**
 * Bound — Apps tab.
 *
 * Demo service catalog (Swiggy, Amazon, Uber, IndiGo, MakeMyTrip). Every card
 * is labeled "Demo Integration": there is no OAuth and no real merchant API.
 * Connection state is derived from REAL mandates; connecting creates a REAL
 * mandate (agent + category + purpose + cap), so the backend authorization
 * model governs everything after that.
 */

import React, { useMemo, useState } from 'react';
import type { AgentNode, MandateItem } from '../types';
import { DEMO_APPS, connectionsForApps, type DemoAppDef } from '../apps';
import { EmptyState, Modal, StatusBadge, inputClass, labelClass, PrimaryButton, SecondaryButton } from '../components/ui';

interface AppsViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  onCreateMandate: (payload: { agent_id: string; purpose: string; max_amount: number; merchant_category: string; expires_at?: string | null }) => Promise<void>;
  onEditLimit: (m: MandateItem) => void;
  onToggleMandate: (id: string) => Promise<void>;
}

export const AppsView: React.FC<AppsViewProps> = ({ agents, mandates, onCreateMandate, onEditLimit, onToggleMandate }) => {
  const [connectApp, setConnectApp] = useState<DemoAppDef | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const eligibleAgents = useMemo(() => agents.filter((a) => !a.is_task_agent && a.status === 'ACTIVE'), [agents]);
  const connections = useMemo(() => connectionsForApps(DEMO_APPS, mandates, agents), [mandates, agents]);
  const connectedCount = connections.filter((c) => c.mandates.length > 0).length;

  const toggle = async (m: MandateItem) => {
    setBusyId(m.id);
    try {
      await onToggleMandate(m.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Apps</h1>
        <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">
          Services your agents can use. {connectedCount} of {DEMO_APPS.length} connected. Integrations below are
          simulated demos — connecting one creates a real spending rule that Bound enforces.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {connections.map(({ app, mandates: linked, agentNames }) => {
          const connected = linked.length > 0;
          const managing = manageId === app.id;
          return (
            <div key={app.id} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-[#f2f3f6] flex items-center justify-center text-[20px] shrink-0">{app.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#0b1c30] truncate">{app.name}</p>
                    <p className="text-[12px] text-[#76777d] truncate">{app.tagline}</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#eef1f6] text-[#45464d] border border-[#e2e3e8] shrink-0">
                  Demo Integration
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0a6b4a]' : 'bg-[#9a9ba1]'}`} />
                <p className="text-[13px] text-[#0b1c30]">
                  {connected ? <span className="font-medium">Connected</span> : 'Not connected'}
                  {connected && <span className="text-[#5a5c63]"> · Used by: {agentNames.join(', ')}</span>}
                </p>
              </div>

              {connected && (
                <div className="mt-2 space-y-1.5">
                  {linked.map((m) => (
                    <div key={m.id} className="rounded-lg border border-[#eef0f4] px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] text-[#0b1c30] truncate">
                          <span className="font-medium">{m.agentName}</span>
                          <span className="text-[#76777d]"> · up to ₹{m.max_amount.toLocaleString()} · {m.merchant_category}</span>
                        </p>
                      </div>
                      <StatusBadge status={m.status} />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                {connected ? (
                  <>
                    <button onClick={() => setManageId(managing ? null : app.id)} className="px-3.5 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer">
                      {managing ? 'Hide' : 'Manage'}
                    </button>
                    <button onClick={() => setConnectApp(app)} disabled={eligibleAgents.length === 0} className="px-3.5 py-2 rounded-lg bg-white border border-[#c6c6cd] text-[#0b1c30] text-[13px] font-medium hover:border-[#0b1c30] cursor-pointer disabled:opacity-60">
                      + Add agent
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConnectApp(app)} disabled={eligibleAgents.length === 0} className="px-3.5 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60">
                    Connect
                  </button>
                )}
              </div>

              {managing && connected && (
                <div className="mt-2.5 rounded-lg bg-[#fafbff] border border-[#eef0f4] p-3 space-y-2">
                  {linked.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2">
                      <p className="text-[12px] text-[#5a5c63] truncate min-w-0">
                        {m.agentName} · ₹{m.max_amount.toLocaleString()} · {m.merchant_category} · {m.purpose}
                      </p>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => onEditLimit(m)} className="text-[12px] font-medium text-[#0051d5] hover:underline cursor-pointer">Edit limit</button>
                        <button onClick={() => toggle(m)} disabled={busyId === m.id} className="text-[12px] font-medium text-[#93000a] hover:underline cursor-pointer disabled:opacity-60">
                          {busyId === m.id ? 'Working…' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {eligibleAgents.length === 0 && (
        <EmptyState title="No active agents" body="Register an agent first — apps connect through an agent's spending rule." />
      )}

      {connectApp && (
        <ConnectAppDialog
          app={connectApp}
          agents={eligibleAgents}
          onClose={() => setConnectApp(null)}
          onCreate={onCreateMandate}
        />
      )}
    </div>
  );
};

function ConnectAppDialog({
  app,
  agents,
  onClose,
  onCreate,
}: {
  app: DemoAppDef;
  agents: AgentNode[];
  onClose: () => void;
  onCreate: AppsViewProps['onCreateMandate'];
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [category, setCategory] = useState(app.categories[0]);
  const [purpose, setPurpose] = useState('');
  const [cap, setCap] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseFloat(cap);
    if (!agentId) {
      setError('Select an agent.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Enter a limit greater than zero.');
      return;
    }
    if (!purpose.trim()) {
      setError('Describe what the agent may use it for.');
      return;
    }
    setBusy(true);
    try {
      await onCreate({ agent_id: agentId, purpose: purpose.trim(), max_amount: amount, merchant_category: category });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">Connect {app.name}</h3>
      <p className="text-[12px] text-[#5a5c63] mt-1">
        Demo Integration — no real {app.name} account is linked. This creates a real Bound spending rule.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label className={labelClass()}>Agent</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass()}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
            {app.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass()}>Purpose</label>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Team dinners" maxLength={120} className={`${inputClass()} mt-1`} />
        </div>
        <div>
          <label className={labelClass()}>Spending limit (₹)</label>
          <input type="number" min="1" step="any" value={cap} onChange={(e) => setCap(e.target.value)} className={`${inputClass()} mt-1`} />
        </div>
        {error && <p className="text-[13px] text-[#93000a]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton type="button" onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Connecting…' : `Connect ${app.name}`}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
