/**
 * Bound — Delegation visualization.
 *
 * Renders USER → Root Mandate → Agent → Payment Agent chains from REAL
 * backend mandates/delegations. Effective authority can only shrink through
 * delegation; revoking a parent visibly removes the child's authority.
 * Revoke buttons call the real backend handlers passed in as props.
 */

import React, { useState } from 'react';
import type { AgentNode, DelegationItem, MandateItem } from '../types';
import { StatusBadge } from './ui';

interface DelegationVizProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  delegations: DelegationItem[];
  onRevokeAgent: (agentId: string) => Promise<void>;
  onRevokeDelegation: (id: string) => Promise<void>;
  onOpenCreateDelegation: () => void;
}

function Arrow() {
  return <div className="flex justify-center" aria-hidden="true"><span className="text-[#9a9ba1] text-[16px] leading-none">↓</span></div>;
}

export const DelegationViz: React.FC<DelegationVizProps> = ({
  agents,
  mandates,
  delegations,
  onRevokeAgent,
  onRevokeDelegation,
  onOpenCreateDelegation,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armId, setArmId] = useState<string | null>(null);

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const userAgents = agents.filter((a) => !a.is_task_agent);
  // Root mandates: ACTIVE or REVOKED mandates on user agents (show revoked too,
  // so the effect of revocation stays visible).
  const roots = mandates.filter((m) => agentById.get(m.agent_id) && !agentById.get(m.agent_id)?.is_task_agent);
  const childrenOf = (agentId: string) => delegations.filter((d) => d.parentAgentId === agentId);

  const runRevoke = async (kind: 'agent' | 'delegation', id: string) => {
    if (armId !== `${kind}:${id}`) {
      setArmId(`${kind}:${id}`);
      return;
    }
    setBusyId(`${kind}:${id}`);
    try {
      if (kind === 'agent') await onRevokeAgent(id);
      else await onRevokeDelegation(id);
    } finally {
      setBusyId(null);
      setArmId(null);
    }
  };

  const revokeBtn = (kind: 'agent' | 'delegation', id: string, label: string) => {
    const key = `${kind}:${id}`;
    const armed = armId === key;
    const busy = busyId === key;
    return (
      <button
        onClick={() => runRevoke(kind, id)}
        disabled={busy}
        className={`px-2.5 py-1 rounded-lg text-[12px] font-medium cursor-pointer disabled:opacity-60 shrink-0 ${
          armed ? 'bg-[#ba1a1a] text-white' : 'bg-[#fdecea] text-[#93000a] hover:bg-[#fbd9d5]'
        }`}
      >
        {busy ? 'Working…' : armed ? 'Confirm revoke' : label}
      </button>
    );
  };

  if (roots.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
        <h2 className="text-[15px] font-semibold text-[#0b1c30]">Delegation</h2>
        <p className="text-[13px] text-[#5a5c63] mt-1">
          No spending rules yet. Authority starts with your rule — then agents can pass a smaller slice to helpers.
        </p>
        <p className="text-[13px] text-[#0b1c30] mt-2 font-medium">Effective authority can only shrink through delegation.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-[#0b1c30]">Delegation</h2>
          <p className="text-[12px] text-[#5a5c63] mt-0.5">
            How your authority flows down. Effective authority can only shrink through delegation.
          </p>
        </div>
        <button onClick={onOpenCreateDelegation} className="text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer shrink-0">
          + New helper permission
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {roots.map((m) => {
          const agent = agentById.get(m.agent_id);
          if (!agent) return null;
          const kids = childrenOf(agent.id);
          const agentRevoked = agent.status !== 'ACTIVE';
          return (
            <div key={m.id} className="rounded-lg border border-[#eef0f4] bg-[#fafbff] p-3.5">
              <div className="rounded-lg bg-white border border-[#e2e3e8] px-3 py-2.5 text-center">
                <p className="text-[11px] font-medium text-[#76777d] uppercase tracking-wide">You</p>
                <p className="text-[13px] text-[#0b1c30]">Root mandate · up to ₹{m.max_amount.toLocaleString()}</p>
                <p className="text-[12px] text-[#76777d] truncate">{m.purpose} · {m.merchant_category}</p>
              </div>
              <Arrow />
              <div className="rounded-lg bg-white border border-[#e2e3e8] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-[#0b1c30] truncate">{agent.name}</p>
                  <StatusBadge status={agent.status} />
                </div>
                <p className="text-[12px] text-[#5a5c63] mt-0.5">₹{m.max_amount.toLocaleString()} · {m.merchant_category}</p>
                <div className="mt-1.5">{revokeBtn('agent', agent.id, agentRevoked ? 'Revoked — tap to restore' : 'Revoke')}</div>
              </div>
              {kids.map((d) => {
                const child = agentById.get(d.childAgentId);
                const childLive = d.status === 'ACTIVE' && !agentRevoked && child?.status === 'ACTIVE';
                return (
                  <React.Fragment key={d.id}>
                    <Arrow />
                    <div className="rounded-lg bg-white border border-[#e2e3e8] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold text-[#0b1c30] truncate">{d.childAgentName}</p>
                        <StatusBadge status={childLive ? 'ACTIVE' : 'REVOKED'} />
                      </div>
                      <p className="text-[12px] text-[#5a5c63] mt-0.5">
                        {d.delegatedLimitFormatted} · {d.merchantCategory}
                        {!childLive && <span className="text-[#93000a]"> · No effective authority</span>}
                      </p>
                      {agentRevoked && (
                        <p className="text-[12px] text-[#93000a] mt-0.5">
                          Parent revoked — attempted actions need review with no approval path.
                        </p>
                      )}
                      <div className="mt-1.5 flex gap-2">
                        {d.status === 'ACTIVE' && revokeBtn('delegation', d.id, 'Revoke')}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
