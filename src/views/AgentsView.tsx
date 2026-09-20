/**
 * Bound — Agents tab.
 *
 * Each agent with its spending rules (caps from real mandates, spent from
 * real transactions), its delegations, and revoke/restore — plus the full
 * delegation visualization. Rule/delegation CRUD reuses the same backend
 * endpoints the old Rules tab used; only the location changed.
 */

import React, { useMemo, useState } from 'react';
import { AgentNode, DelegationItem, MandateItem, TransactionRecord } from '../types';
import { ConfirmDialog, EmptyState, SectionTitle, StatusBadge, TechnicalDetails, TechRow, PrimaryButton, SecondaryButton } from '../components/ui';
import { DelegationViz } from '../components/DelegationViz';

interface AgentsViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  delegations: DelegationItem[];
  transactions: TransactionRecord[];
  onOpenRegister: () => void;
  onRevokeAgent: (agentId: string) => Promise<void>;
  onOpenCreateMandate: () => void;
  onAddRuleForAgent: (agentId: string) => void;
  onEditLimit: (m: MandateItem) => void;
  onToggleMandate: (id: string) => Promise<void>;
  onOpenCreateDelegation: () => void;
  onRevokeDelegation: (id: string) => Promise<void>;
}

function spendForAgent(agentId: string, txs: TransactionRecord[]): number {
  return txs.filter((t) => t.agent_id === agentId).reduce((s, t) => s + (t.rawAmount || 0), 0);
}

function spentForMandate(mandateId: string, txs: TransactionRecord[]): number {
  return txs.filter((t) => t.mandate_id === mandateId).reduce((s, t) => s + t.rawAmount, 0);
}

function domainLabel(domain: AgentNode['domain']): string | null {
  if (domain === 'FOOD') return 'Food';
  if (domain === 'TRAVEL') return 'Travel';
  if (domain === 'SHOPPING') return 'Shopping';
  return null;
}

export const AgentsView: React.FC<AgentsViewProps> = ({
  agents,
  mandates,
  delegations,
  transactions,
  onOpenRegister,
  onRevokeAgent,
  onOpenCreateMandate,
  onAddRuleForAgent,
  onEditLimit,
  onToggleMandate,
  onOpenCreateDelegation,
  onRevokeDelegation,
}) => {
  // Ephemeral task agents are security machinery — never listed as user agents.
  const visibleAgents = useMemo(() => agents.filter((a) => !a.is_task_agent), [agents]);
  const hiddenTaskAgents = agents.length - visibleAgents.length;
  const [selectedId, setSelectedId] = useState<string>(visibleAgents[0]?.id || '');
  const [confirmTarget, setConfirmTarget] = useState<AgentNode | null>(null);
  const [confirmMandate, setConfirmMandate] = useState<MandateItem | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = visibleAgents.find((a) => a.id === selectedId) || visibleAgents[0];

  const agentMandates = useMemo(
    () => (selected ? mandates.filter((m) => m.agent_id === selected.id) : []),
    [mandates, selected]
  );
  const relatedDelegations = useMemo(
    () => (selected ? delegations.filter((d) => d.parentAgentId === selected.id || d.childAgentId === selected.id) : []),
    [delegations, selected]
  );

  const handleAgentConfirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      await onRevokeAgent(confirmTarget.id);
    } finally {
      setBusy(false);
      setConfirmTarget(null);
    }
  };

  const handleMandateConfirm = async () => {
    if (!confirmMandate) return;
    setBusy(true);
    try {
      await onToggleMandate(confirmMandate.id);
    } finally {
      setBusy(false);
      setConfirmMandate(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Agents</h1>
          <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">Give AI agents limited authority to act on your behalf. A rule never gives an agent access to all your money — only its own bounded slice.</p>
        </div>
        <PrimaryButton onClick={onOpenRegister}>New agent</PrimaryButton>
      </div>

      {visibleAgents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          body="Create your first agent, then give it a spending rule: a purpose, a per-order limit, and an allowed category. Until then nothing can spend."
          action={<PrimaryButton onClick={onOpenRegister}>Create agent</PrimaryButton>}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 space-y-2">
            {hiddenTaskAgents > 0 && (
              <p className="text-[12px] text-[#76777d] px-1">
                {hiddenTaskAgents} internal task agent{hiddenTaskAgents === 1 ? '' : 's'} hidden — short-lived task machinery, not user agents.
              </p>
            )}
            {visibleAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`w-full text-left p-3.5 rounded-xl border cursor-pointer transition-colors ${
                  selected?.id === a.id ? 'bg-white border-[#0b1c30]' : 'bg-white border-[#e2e3e8] hover:border-[#9a9ba1]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-[#0b1c30] truncate">
                    {a.name}
                    {domainLabel(a.domain) && <span className="ml-1.5 text-[11px] font-normal text-[#76777d]">· {domainLabel(a.domain)}</span>}
                  </span>
                  <StatusBadge status={a.status} />
                </div>
                {a.description && <p className="text-[12px] text-[#76777d] truncate mt-1">{a.description}</p>}
              </button>
            ))}
          </div>

          <div className="lg:col-span-8">
            {selected ? (
              <div className="rounded-xl bg-white border border-[#e2e3e8] p-5 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[17px] font-semibold text-[#0b1c30]">{selected.name}</h2>
                      <StatusBadge status={selected.status} />
                      {domainLabel(selected.domain) && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#eef1f6] text-[#0b1c30]">
                          {domainLabel(selected.domain)}
                        </span>
                      )}
                    </div>
                    {selected.description ? (
                      <p className="text-[13px] text-[#5a5c63] mt-1">{selected.description}</p>
                    ) : (
                      <p className="text-[13px] text-[#76777d] mt-1">No description.</p>
                    )}
                  </div>
                  {selected.status === 'ACTIVE' ? (
                    <button
                      onClick={() => setConfirmTarget(selected)}
                      className="px-3.5 py-2 rounded-lg bg-[#fdecea] text-[#93000a] text-[13px] font-medium hover:bg-[#fbd9d5] cursor-pointer shrink-0"
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmTarget(selected)}
                      className="px-3.5 py-2 rounded-lg bg-[#e6f4ee] text-[#0a6b4a] text-[13px] font-medium hover:bg-[#d4ecdf] cursor-pointer shrink-0"
                    >
                      Restore
                    </button>
                  )}
                </div>

                {/* Spending rules — real mandate caps + real spend */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <SectionTitle title="Spending rules" sub="What this agent may spend, where, and until when." />
                    <button onClick={() => onAddRuleForAgent(selected.id)} className="text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer shrink-0">
                      + Add rule
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {agentMandates.length === 0 ? (
                      <p className="text-[13px] text-[#76777d] rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2.5">No spending rules for this agent yet.</p>
                    ) : (
                      agentMandates.map((m) => {
                        const spent = spentForMandate(m.id, transactions);
                        const remaining = Math.max(0, m.max_amount - spent);
                        const revoked = m.status !== 'ACTIVE';
                        return (
                          <div key={m.id} className="rounded-lg border border-[#eef0f4] px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2 text-[13px]">
                              <span className="font-medium text-[#0b1c30] truncate">{m.purpose} · {m.merchant_category}</span>
                              <StatusBadge status={m.status} />
                            </div>
                            <p className="text-[13px] text-[#45464d] mt-1">
                              ₹{spent.toLocaleString()} spent of ₹{m.max_amount.toLocaleString()} limit
                              {m.status === 'ACTIVE' && <span className="text-[#0a6b4a]"> · ₹{remaining.toLocaleString()} left</span>}
                            </p>
                            <div className="w-full bg-[#eef1f6] h-1.5 rounded-full overflow-hidden mt-2">
                              <div className="bg-[#0b1c30] h-full rounded-full" style={{ width: `${m.max_amount > 0 ? Math.min(100, Math.round((spent / m.max_amount) * 100)) : 0}%` }} />
                            </div>
                            <div className="mt-2 flex gap-2">
                              {!revoked && (
                                <button onClick={() => onEditLimit(m)} className="px-3 py-1.5 rounded-lg bg-[#eef1f6] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer">
                                  Edit rule
                                </button>
                              )}
                              <button
                                onClick={() => setConfirmMandate(m)}
                                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer ${revoked ? 'bg-[#e6f4ee] text-[#0a6b4a] hover:bg-[#d4ecdf]' : 'bg-[#fdecea] text-[#93000a] hover:bg-[#fbd9d5]'}`}
                              >
                                {revoked ? 'Re-activate' : 'Revoke'}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <p className="text-[12px] text-[#76777d]">Total across all recorded payments: ₹{spendForAgent(selected.id, transactions).toLocaleString()}</p>
                  </div>
                </div>

                {/* Delegations */}
                <div>
                  <SectionTitle title="Delegations" sub="Authority this agent passed to others, or received from others." />
                  <div className="mt-3">
                    {relatedDelegations.length === 0 ? (
                      <p className="text-[13px] text-[#76777d]">No delegations involving this agent.</p>
                    ) : (
                      <ul className="space-y-2">
                        {relatedDelegations.map((d) => {
                          const isParent = d.parentAgentId === selected.id;
                          return (
                            <li key={d.id} className="text-[13px] text-[#0b1c30] rounded-lg border border-[#eef0f4] px-3 py-2.5">
                              <span className="font-medium">{d.delegatedLimitFormatted}</span>{' '}
                              {isParent ? (
                                <span>passed to <span className="font-medium">{d.childAgentName}</span></span>
                              ) : (
                                <span>received from <span className="font-medium">{d.parentAgentName}</span></span>
                              )}{' '}
                              <span className="text-[#76777d]">for {d.purpose} · {d.status === 'ACTIVE' ? 'Active' : d.status === 'EXPIRED' ? 'Expired' : 'Revoked'}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                <TechnicalDetails summary="Technical details">
                  <TechRow k="Agent ID" v={selected.id} />
                  <TechRow k="Domain" v={selected.domain} />
                  <TechRow k="Created" v={new Date(selected.created_at).toLocaleString()} />
                  <TechRow k="Mandates" v={agentMandates.length ? agentMandates.map((m) => m.id).join(', ') : '—'} />
                  <TechRow k="Recorded payments" v={String(transactions.filter((t) => t.agent_id === selected.id).length)} />
                </TechnicalDetails>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <DelegationViz
        agents={agents}
        mandates={mandates}
        delegations={delegations}
        onRevokeAgent={onRevokeAgent}
        onRevokeDelegation={onRevokeDelegation}
        onOpenCreateDelegation={onOpenCreateDelegation}
      />

      {mandates.length > 0 && (
        <div className="flex justify-end">
          <SecondaryButton onClick={onOpenCreateMandate}>New rule for another agent</SecondaryButton>
        </div>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.status === 'ACTIVE' ? `Revoke ${confirmTarget.name}?` : `Restore ${confirmTarget.name}?`}
          body={
            confirmTarget.status === 'ACTIVE'
              ? 'This agent will no longer be able to make payments. Its helpers lose effective authority too. Existing records are kept. You can restore it later.'
              : 'This agent will be able to make payments again within its active spending rules.'
          }
          confirmLabel={confirmTarget.status === 'ACTIVE' ? 'Revoke agent' : 'Restore agent'}
          danger={confirmTarget.status === 'ACTIVE'}
          busy={busy}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handleAgentConfirm}
        />
      )}

      {confirmMandate && (
        <ConfirmDialog
          title={confirmMandate.status === 'ACTIVE' ? `Revoke rule for ${confirmMandate.agentName}?` : `Re-activate rule for ${confirmMandate.agentName}?`}
          body={
            confirmMandate.status === 'ACTIVE'
              ? `“${confirmMandate.purpose}” (₹${confirmMandate.max_amount.toLocaleString()}) will stop authorizing new payments. Past records are kept.`
              : `“${confirmMandate.purpose}” will authorize payments again within its limit.`
          }
          confirmLabel={confirmMandate.status === 'ACTIVE' ? 'Revoke rule' : 'Re-activate rule'}
          danger={confirmMandate.status === 'ACTIVE'}
          busy={busy}
          onCancel={() => setConfirmMandate(null)}
          onConfirm={handleMandateConfirm}
        />
      )}
    </div>
  );
};
