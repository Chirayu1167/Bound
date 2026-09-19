import React, { useState } from 'react';
import { MandateItem } from '../types';

interface MandatesViewProps {
  mandates: MandateItem[];
  onOpenCreateMandate: () => void;
  onEditLimit: (mandate: MandateItem) => void;
  onToggleRevoke: (id: string) => void;
}

export const MandatesView: React.FC<MandatesViewProps> = ({
  mandates,
  onOpenCreateMandate,
  onEditLimit,
  onToggleRevoke,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'threshold' | 'revoked'>('all');

  const filteredMandates = mandates.filter((m) => {
    if (filter === 'active') return m.status === 'ACTIVE';
    if (filter === 'threshold') return m.isThresholdImminent;
    if (filter === 'revoked') return m.status === 'REVOKED';
    return true;
  });

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">
            Permission Envelopes &amp; Policy Registry
          </span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">
            Spending Mandates
          </h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">
            Cryptographically enforced permission contracts between human principals and autonomous runtimes.
          </p>
        </div>

        <button
          onClick={onOpenCreateMandate}
          className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[16px]">add_moderator</span>
          <span>Issue Mandate</span>
        </button>
      </div>

      {/* Filter Tabs & Quick KPI Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
            filter === 'all'
              ? 'bg-[#000000] text-[#ffffff]'
              : 'bg-[#eff4ff] text-[#45464d] hover:bg-[#e5eeff]'
          }`}
        >
          All Mandates ({mandates.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
            filter === 'active'
              ? 'bg-[#000000] text-[#ffffff]'
              : 'bg-[#eff4ff] text-[#45464d] hover:bg-[#e5eeff]'
          }`}
        >
          Active Enforcing ({mandates.filter((m) => m.status === 'ACTIVE').length})
        </button>
        <button
          onClick={() => setFilter('threshold')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
            filter === 'threshold'
              ? 'bg-[#000000] text-[#ffffff]'
              : 'bg-[#eff4ff] text-[#45464d] hover:bg-[#e5eeff]'
          }`}
        >
          Threshold Approaching ({mandates.filter((m) => m.isThresholdImminent).length})
        </button>
        <button
          onClick={() => setFilter('revoked')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
            filter === 'revoked'
              ? 'bg-[#000000] text-[#ffffff]'
              : 'bg-[#eff4ff] text-[#45464d] hover:bg-[#e5eeff]'
          }`}
        >
          Revoked / Terminated ({mandates.filter((m) => m.status === 'REVOKED').length})
        </button>
      </div>

      {/* Mandates List */}
      <div className="space-y-4">
        {filteredMandates.map((mandate) => {
          const percentUsed = Math.min(100, Math.round((mandate.spent / mandate.cap) * 100));
          const isRevoked = mandate.status === 'REVOKED';

          return (
            <div
              key={mandate.id}
              className={`p-6 rounded-xl bg-[#ffffff] border transition-all ${
                isRevoked
                  ? 'border-[#c6c6cd]/30 opacity-75'
                  : mandate.isThresholdImminent
                  ? 'border-[#316bf3]/50 shadow-xs'
                  : 'border-[#c6c6cd]/30 shadow-xs hover:border-[#0051d5]/40'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#c6c6cd]/20">
                {/* Left identity */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#0051d5] font-semibold border border-[#c6c6cd]/30">
                      {mandate.code}
                    </span>
                    <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
                      {mandate.name}
                    </h3>
                    <span
                      className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                        isRevoked
                          ? 'bg-[#ffdad6] text-[#93000a]'
                          : 'bg-[#eff4ff] text-[#009668]'
                      }`}
                    >
                      {mandate.status}
                    </span>
                  </div>
                  <p className="text-[12px] font-mono text-[#76777d]">
                    {mandate.expiry} · Signed by Vault Root KMS
                  </p>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2">
                  {!isRevoked && (
                    <button
                      onClick={() => onEditLimit(mandate)}
                      className="px-3 py-1.5 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1 border border-[#c6c6cd]/30"
                    >
                      <span className="material-symbols-outlined text-[16px]">tune</span>
                      <span>Edit Limit</span>
                    </button>
                  )}
                  <button
                    onClick={() => onToggleRevoke(mandate.id)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      isRevoked
                        ? 'bg-[#eff4ff] text-[#009668] hover:bg-[#dce9ff]'
                        : 'bg-[#ffdad6] text-[#93000a] hover:bg-[#ffb4ab]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isRevoked ? 'restore' : 'block'}
                    </span>
                    <span>{isRevoked ? 'Re-activate' : 'Revoke Mandate'}</span>
                  </button>
                </div>
              </div>

              {/* Middle Metrics & Bar */}
              <div className="py-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="md:col-span-2 space-y-2">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <div>
                      <span className="font-mono text-[16px] font-semibold text-[#0b1c30]">
                        ₹{mandate.spent.toLocaleString()}
                      </span>
                      <span className="font-mono text-[13px] text-[#76777d]">
                        {' '}
                        / ₹{mandate.cap.toLocaleString()}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-[11px] font-medium ${
                        mandate.isThresholdImminent ? 'text-[#0051d5]' : 'text-[#76777d]'
                      }`}
                    >
                      {mandate.safeBuffer}
                    </span>
                  </div>

                  <div className="w-full bg-[#eff4ff] h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isRevoked
                          ? 'bg-[#76777d]'
                          : mandate.isThresholdImminent
                          ? 'bg-[#0051d5]'
                          : 'bg-[#009668]'
                      }`}
                      style={{ width: `${percentUsed}%` }}
                    ></div>
                  </div>
                </div>

                <div className="space-y-1 font-mono text-[11px] text-[#45464d] bg-[#eff4ff]/60 p-3 rounded-lg border border-[#c6c6cd]/25">
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Bound Agent:</span>
                    <span className="font-medium text-[#0b1c30]">{mandate.boundAgent}</span>
                  </div>
                  {mandate.subDelegationNote && (
                    <div className="flex justify-between">
                      <span className="text-[#76777d]">Delegation:</span>
                      <span>{mandate.subDelegationNote}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#76777d]">Hash:</span>
                    <span>{mandate.agentHash}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Scope constraint tag */}
              <div className="pt-3 border-t border-[#c6c6cd]/20 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[#0b1c30]">Permitted Scope:</span>
                  <span className="text-[#45464d]">{mandate.permittedScopeTitle}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-[#eff4ff] text-[#0b1c30] border border-[#c6c6cd]/30">
                    {mandate.mccCode}
                  </span>
                  <span className="text-[#76777d]">{mandate.mccDetail}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Explainer Box: What is a Mandate in Bound? */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0051d5] text-[20px]">
            help_outline
          </span>
          <h3 className="font-headline-sm text-[16px] text-[#0b1c30] font-semibold">
            What is a Mandate in Bound?
          </h3>
        </div>
        <p className="font-body-md text-[13px] text-[#45464d] leading-relaxed">
          A Mandate is not a soft spending policy or post-facto audit filter. It is an immutable cryptographic envelope generated inside a hardware security module (HSM) that strictly governs sub-agent capability tokens.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#009668]">lock</span>
              Strict Enclave Confinement
            </span>
            <p className="text-[12px] text-[#45464d]">
              Sub-agents cannot exceed or re-delegate authority beyond their assigned envelope ceiling.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#0051d5]">shield</span>
              Zero Credit Exposure
            </span>
            <p className="text-[12px] text-[#45464d]">
              POS or API attempts above the threshold fail deterministically before reaching card rails.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1">
            <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#000000]">bolt</span>
              Sub-10ms Global Revocation
            </span>
            <p className="text-[12px] text-[#45464d]">
              Revocation invalidates all downstream ephemeral tokens across regional edge enclaves in under 10ms.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
