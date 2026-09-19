import React, { useState } from 'react';
import { DelegationItem, AgentNode, MandateItem } from '../types';

interface DelegationsViewProps {
  delegations: DelegationItem[];
  agents?: AgentNode[];
  mandates?: MandateItem[];
  onOpenCreate: () => void;
  onRevoke: (id: string) => void;
}

export const DelegationsView: React.FC<DelegationsViewProps> = ({ delegations, agents = [], mandates = [], onOpenCreate, onRevoke }) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'revoked' | 'expired'>('all');

  const filtered = delegations.filter((d) => {
    if (filter === 'active') return d.status === 'ACTIVE';
    if (filter === 'revoked') return d.status === 'REVOKED';
    if (filter === 'expired') return d.status === 'EXPIRED';
    return true;
  });

  // Helper: check if delegation is effectively valid (walks upstream)
  const isEffectivelyValid = (d: DelegationItem): { valid: boolean; reason?: string } => {
    // Check parent agent
    const parentAgent = agents.find((a) => a.id === d.parentAgentId);
    if (parentAgent && parentAgent.status !== 'ACTIVE') {
      return { valid: false, reason: `Parent ${parentAgent.name} is ${parentAgent.status}` };
    }
    // Check parent mandate
    const parentMandate = mandates.find((m) => m.id === d.parentMandateId);
    if (parentMandate && parentMandate.status !== 'ACTIVE') {
      return { valid: false, reason: `Root mandate ${parentMandate.code} is ${parentMandate.status}` };
    }
    // Check if parent itself is delegated and that delegation is revoked/expired
    // Find delegation where child == parentAgentId
    const parentDelegation = delegations.find((pd) => pd.childAgentId === d.parentAgentId);
    if (parentDelegation) {
      if (parentDelegation.status !== 'ACTIVE') {
        return { valid: false, reason: `Upstream delegation ${parentDelegation.id} is ${parentDelegation.status}` };
      }
      // Recursively check upstream
      const upstream = isEffectivelyValid(parentDelegation);
      if (!upstream.valid) return upstream;
    }
    return { valid: true };
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">Delegated Authority · Child ≤ Parent</span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">Delegations</h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">
            Agent A delegates a bounded subset of its mandate to Agent B. <span className="font-mono text-[11px] bg-[#eff4ff] px-1.5 py-0.5 rounded border border-[#c6c6cd]/30">AUTHORITY(child) ⊆ AUTHORITY(parent)</span>
          </p>
        </div>

        <button
          onClick={onOpenCreate}
          className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[16px]">account_tree</span>
          <span>Create Delegation</span>
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: `All (${delegations.length})` },
          { id: 'active', label: `Active (${delegations.filter((d) => d.status === 'ACTIVE').length})` },
          { id: 'revoked', label: `Revoked (${delegations.filter((d) => d.status === 'REVOKED').length})` },
          { id: 'expired', label: `Expired (${delegations.filter((d) => d.status === 'EXPIRED').length})` },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as any)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${filter === f.id ? 'bg-[#000000] text-[#ffffff]' : 'bg-[#eff4ff] text-[#45464d] hover:bg-[#e5eeff]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Delegations list */}
      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="p-8 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 text-center text-[13px] text-[#76777d]">
            No delegations in this filter. Create one to see <span className="font-medium text-[#0b1c30]">User → Root Mandate → Agent A → Agent B</span>.
          </div>
        )}
        {filtered.map((d) => {
          const isRevoked = d.status !== 'ACTIVE';
          const effective = isEffectivelyValid(d);
          const effectivelyInvalid = !effective.valid && d.status === 'ACTIVE';
          return (
            <div key={d.id} className={`p-6 rounded-xl bg-[#ffffff] border transition-all ${isRevoked ? 'border-[#c6c6cd]/30 opacity-75' : effectivelyInvalid ? 'border-[#ba1a1a]/40 bg-[#ffdad6]/20' : 'border-[#c6c6cd]/30 shadow-xs hover:border-[#0051d5]/40'}`}>
              {effectivelyInvalid && (
                <div className="mb-4 p-2 rounded-lg bg-[#ffdad6] border border-[#ba1a1a]/30 text-[#93000a] font-mono text-[11px] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">warning</span>
                  <span>Effectively invalid — {effective.reason} → downstream payments will VERIFY</span>
                </div>
              )}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#c6c6cd]/20">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#0051d5] font-semibold border border-[#c6c6cd]/30">{d.id.toUpperCase()}</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded font-semibold bg-[#e5eeff] text-[#0b1c30]">{d.purpose}</span>
                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${d.status === 'ACTIVE' ? 'bg-[#eff4ff] text-[#009668]' : d.status === 'REVOKED' ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-[#ffdad6] text-[#93000a]'}`}>{d.status}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="text-[#0b1c30]">{d.parentAgentName}</span>
                    <span className="material-symbols-outlined text-[#0051d5] text-[18px]">arrow_forward</span>
                    <span className="text-[#0051d5]">{d.childAgentName}</span>
                    <span className="text-[#76777d] font-mono text-[11px]">via {d.parentMandateName} ({d.parentMandateId})</span>
                  </div>
                  <p className="text-[12px] font-mono text-[#76777d]">{d.expiresLabel} · Created {new Date(d.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>

                <div className="flex items-center gap-2">
                  {!isRevoked && (
                    <button onClick={() => onRevoke(d.id)} className="px-3 py-1.5 rounded-lg bg-[#ffdad6] text-[#93000a] hover:bg-[#ffb4ab] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">block</span>
                      <span>Revoke</span>
                    </button>
                  )}
                  {isRevoked && <span className="text-[11px] font-mono text-[#76777d]">Revoked/Expired — no further delegation allowed</span>}
                </div>
              </div>

              <div className="py-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="md:col-span-2 space-y-2">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <div>
                      <span className="font-mono text-[16px] font-semibold text-[#0b1c30]">{d.delegatedLimitFormatted}</span>
                      <span className="font-mono text-[13px] text-[#76777d]"> delegated cap</span>
                    </div>
                    <span className={`font-mono text-[11px] font-medium ${d.status === 'ACTIVE' ? 'text-[#009668]' : 'text-[#76777d]'}`}>
                      {d.status === 'ACTIVE' ? 'Within parent authority' : d.status}
                    </span>
                  </div>
                  <div className="w-full bg-[#eff4ff] h-2 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${isRevoked ? 'bg-[#76777d]' : 'bg-[#0051d5]'}`} style={{ width: '100%' }}></div>
                  </div>
                  <p className="text-[11px] text-[#45464d] font-mono">Child ≤ Parent enforced • Parent mandate remains authoritative for Agent A</p>
                </div>

                <div className="space-y-1 font-mono text-[11px] text-[#45464d] bg-[#eff4ff]/60 p-3 rounded-lg border border-[#c6c6cd]/25">
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Parent:</span>
                    <span className="font-medium text-[#0b1c30]">{d.parentAgentName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Child:</span>
                    <span className="font-medium text-[#0051d5]">{d.childAgentName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Merchant:</span>
                    <span>{d.merchantCategory}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Purpose:</span>
                    <span>{d.purpose}</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#c6c6cd]/20 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[#0b1c30]">Chain:</span>
                  <span className="font-mono text-[11px] text-[#45464d]">User → Root Mandate ({d.parentMandateId}) → {d.parentAgentName} → {d.childAgentName}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-[#eff4ff] text-[#0b1c30] border border-[#c6c6cd]/30">{d.merchantCategory}</span>
                  <span className="text-[#76777d]">Child ⊆ Parent</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Explainer */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0051d5] text-[20px]">help_outline</span>
          <h3 className="font-headline-sm text-[16px] text-[#0b1c30] font-semibold">Delegation in Bound</h3>
        </div>
        <p className="font-body-md text-[13px] text-[#45464d] leading-relaxed">
          A delegation is a bounded capability token. It cannot exceed its parent mandate in amount or purpose. Payments by Agent B are evaluated against the entire chain: B active → delegation active → A active → root mandate valid → amount ≤ delegated limit → purpose allowed. Any failure → <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#ffdad6] text-[#93000a]">VERIFY</span>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#009668]">lock</span>
              Bounded Authority
            </span>
            <p className="text-[12px] text-[#45464d]">Child limit ≤ parent max. Exceeding is rejected at creation.</p>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#0051d5]">shield</span>
              Scope Containment
            </span>
            <p className="text-[12px] text-[#45464d]">Purpose/category must be within parent scope. Electronics from Groceries → VERIFY.</p>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#000000]">bolt</span>
              Chain Verification
            </span>
            <p className="text-[12px] text-[#45464d]">Revoke parent or delegation → child payments VERIFY instantly.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
