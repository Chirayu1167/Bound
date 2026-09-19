import React, { useMemo, useState } from 'react';
import { AgentNode, DelegationItem, MandateItem, TransactionRecord } from '../types';
import { DOMAINS, ruleSummary, scopeLine, type DomainDef } from '../domains';
import { ConfirmDialog, EmptyState, PrimaryButton, SecondaryButton, StatusBadge, TechnicalDetails, TechRow } from '../components/ui';

interface RulesViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  delegations: DelegationItem[];
  transactions: TransactionRecord[];
  onOpenCreateMandate: () => void;
  onOpenCreateDelegation: () => void;
  onEditLimit: (m: MandateItem) => void;
  onToggleMandate: (id: string) => Promise<void>;
  onRevokeDelegation: (id: string) => Promise<void>;
  onAddRuleForAgent: (agentId: string) => void;
}

/** Backend domain → display def. Task agents and OTHER have no domain card. */
function domainDefFor(domain: string): DomainDef | null {
  return DOMAINS.find((d) => d.id.toUpperCase() === domain) || null;
}

function spentForMandate(mandateId: string, txs: TransactionRecord[]): number {
  return txs.filter((t) => t.mandate_id === mandateId).reduce((s, t) => s + t.rawAmount, 0);
}

export const RulesView: React.FC<RulesViewProps> = ({
  agents,
  mandates,
  delegations,
  transactions,
  onOpenCreateMandate,
  onOpenCreateDelegation,
  onEditLimit,
  onToggleMandate,
  onRevokeDelegation,
  onAddRuleForAgent,
}) => {
  const [sub, setSub] = useState<'rules' | 'advanced'>('rules');
  const [confirmMandate, setConfirmMandate] = useState<MandateItem | null>(null);
  const [confirmDelegation, setConfirmDelegation] = useState<DelegationItem | null>(null);
  const [busy, setBusy] = useState(false);

  const byAgent = useMemo(() => {
    const groups = new Map<string, { agentName: string; agentId: string; mandates: MandateItem[] }>();
    for (const m of mandates) {
      const g = groups.get(m.agent_id) || { agentName: m.agentName, agentId: m.agent_id, mandates: [] };
      g.mandates.push(m);
      groups.set(m.agent_id, g);
    }
    return [...groups.values()];
  }, [mandates]);

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

  const handleDelegationConfirm = async () => {
    if (!confirmDelegation) return;
    setBusy(true);
    try {
      await onRevokeDelegation(confirmDelegation.id);
    } finally {
      setBusy(false);
      setConfirmDelegation(null);
    }
  };

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  /** Domain comes from the backend agent record — never inferred here. */
  const domainForMandate = (m: MandateItem): DomainDef | null => {
    const agent = agentById.get(m.agent_id);
    if (!agent || agent.is_task_agent) return null;
    return domainDefFor(agent.domain);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Spending rules</h1>
          <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">What each agent is allowed to spend, where, and until when. Agents can&apos;t spend outside their rules.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <SecondaryButton onClick={onOpenCreateMandate}>New rule</SecondaryButton>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-lg bg-[#f2f3f6] w-fit">
        <button onClick={() => setSub('rules')} className={`px-3 py-1.5 rounded-md text-[13px] cursor-pointer ${sub === 'rules' ? 'bg-white font-semibold shadow-sm text-[#0b1c30]' : 'text-[#5a5c63]'}`}>
          Rules ({mandates.length})
        </button>
        <button onClick={() => setSub('advanced')} className={`px-3 py-1.5 rounded-md text-[13px] cursor-pointer ${sub === 'advanced' ? 'bg-white font-semibold shadow-sm text-[#0b1c30]' : 'text-[#5a5c63]'}`}>
          Advanced ({delegations.length})
        </button>
      </div>

      {sub === 'rules' ? (
        mandates.length === 0 ? (
          <EmptyState title="No spending rules yet" body="Create a rule to say how much an agent can spend, in which category, and until when." action={<PrimaryButton onClick={onOpenCreateMandate}>Create rule</PrimaryButton>} />
        ) : (
          <div className="space-y-4">
            {byAgent.map((g) => (
              <div key={g.agentId} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold text-[#0b1c30]">{g.agentName}</h2>
                  <button onClick={() => onAddRuleForAgent(g.agentId)} className="text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer shrink-0">
                    + Add rule
                  </button>
                </div>
                <ul className="mt-3 space-y-3">
                  {g.mandates.map((m) => {
                    const spent = spentForMandate(m.id, transactions);
                    const revoked = m.status !== 'ACTIVE';
                    const domain = domainForMandate(m);
                    return (
                      <li key={m.id} className="rounded-lg border border-[#eef0f4] px-3.5 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-semibold text-[#0b1c30]">
                                {domain ? ruleSummary(m, domain) : `Up to ₹${m.max_amount.toLocaleString()}`}
                              </span>
                              <StatusBadge status={m.status} />
                            </div>
                            <p className="text-[13px] text-[#5a5c63] mt-1">
                              {domain ? `${scopeLine(domain, m.merchant_category)} — ` : ''}{m.purpose} · {m.expires_at ? m.expiresLabel : 'Until you revoke it'}
                            </p>
                            <p className="text-[12px] text-[#76777d] mt-0.5">₹{spent.toLocaleString()} spent in recorded payments</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
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
                        <div className="mt-2">
                          <TechnicalDetails summary="Technical details">
                            <TechRow k="Mandate ID" v={m.id} />
                            <TechRow k="Agent ID" v={m.agent_id} />
                            <TechRow k="Created" v={new Date(m.created_at).toLocaleString()} />
                          </TechnicalDetails>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-[#5a5c63] max-w-xl">
            Helper permissions between agents. A helper can never spend more than the rule above it allows.
            Most people never need this section.
          </p>
          {delegations.length === 0 ? (
            <EmptyState title="No helper permissions" body="Helpers are created automatically for tasks in Phase 2. You can also create one manually." action={<PrimaryButton onClick={onOpenCreateDelegation}>New helper permission</PrimaryButton>} />
          ) : (
            <ul className="space-y-2.5">
              {delegations.map((d) => (
                <li key={d.id} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] text-[#0b1c30]">
                          <span className="font-semibold">{d.parentAgentName}</span>
                          <span className="text-[#76777d]"> → </span>
                          <span className="font-semibold">{d.childAgentName}</span>
                        </span>
                        <StatusBadge status={d.status} />
                      </div>
                      <p className="text-[13px] text-[#0b1c30] mt-1">
                        {d.delegatedLimitFormatted} for {d.purpose} <span className="text-[#5a5c63]">· {d.merchantCategory} · {d.expiresLabel}</span>
                      </p>
                      <p className="text-[12px] text-[#76777d] mt-0.5">Under {d.parentMandateName}</p>
                    </div>
                    {d.status === 'ACTIVE' && (
                      <button onClick={() => setConfirmDelegation(d)} className="px-3 py-1.5 rounded-lg bg-[#fdecea] text-[#93000a] text-[13px] font-medium hover:bg-[#fbd9d5] cursor-pointer shrink-0">
                        Revoke
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <TechnicalDetails summary="Lineage details">
                      <TechRow k="Delegation ID" v={d.id} />
                      <TechRow k="Parent agent" v={d.parentAgentId} />
                      <TechRow k="Child agent" v={d.childAgentId} />
                      <TechRow k="Parent mandate" v={d.parentMandateId} />
                    </TechnicalDetails>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
      {confirmDelegation && (
        <ConfirmDialog
          title={`Revoke helper permission for ${confirmDelegation.childAgentName}?`}
          body={`${confirmDelegation.delegatedLimitFormatted} passed from ${confirmDelegation.parentAgentName} to ${confirmDelegation.childAgentName} will no longer authorize payments.`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          onCancel={() => setConfirmDelegation(null)}
          onConfirm={handleDelegationConfirm}
        />
      )}
    </div>
  );
};
