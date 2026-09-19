import React from 'react';
import { AgentNode, MandateItem, TransactionRecord, ActiveTab } from '../types';

interface OverviewViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  transactions: TransactionRecord[];
  onOpenProof: (tx: TransactionRecord) => void;
  onOpenPanic: () => void;
  onOpenCreateMandate: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
  panicSevered?: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  agents,
  transactions,
  onOpenProof,
  onOpenPanic,
  onOpenCreateMandate,
  onNavigateTab,
  panicSevered,
}) => {
  const activeAgentsCount = agents.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Top Banner / Invariant Alert if Panic was clicked */}
      {panicSevered && (
        <div className="p-4 rounded-xl bg-[#ffdad6] border border-[#ba1a1a]/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#ba1a1a] text-[24px]">
              warning
            </span>
            <div>
              <div className="font-headline-sm text-[15px] font-semibold text-[#93000a]">
                Emergency Protocol Engaged: All Agent Keys Severed
              </div>
              <p className="text-[12px] text-[#93000a]/80">
                All enclave delegated credentials have been invalidated across active agents.
              </p>
            </div>
          </div>
          <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-[#ba1a1a] text-[#ffffff] font-medium">
            ENCLAVE ISOLATED
          </span>
        </div>
      )}

      {/* Hero Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">
            Zero-Trust Autonomous Agent Enclave
          </span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">
            Agent Payment Security
          </h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">
            Cryptographically enforced permission contracts and zero-latency enclave authorization for AI agents.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onOpenPanic}
            className="px-3.5 py-2 rounded-lg bg-[#ffdad6] text-[#93000a] text-[12px] font-medium hover:bg-[#ffb4ab] transition-colors cursor-pointer flex items-center gap-1.5 border border-[#ba1a1a]/20"
          >
            <span className="material-symbols-outlined text-[16px]">gavel</span>
            <span>Panic Revoke All</span>
          </button>
          <button
            onClick={onOpenCreateMandate}
            className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">add_moderator</span>
            <span>Create Mandate</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1 */}
        <div className="p-5 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <span className="text-[12px] font-medium text-[#76777d]">
              Active Invariant Enforcement
            </span>
            <span className="material-symbols-outlined text-[#009668] text-[20px]">
              verified
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-lg text-[26px] font-semibold text-[#0b1c30]">
                100%
              </span>
              <span className="font-mono text-[11px] text-[#009668] font-medium">
                0 Violations Settled
              </span>
            </div>
            <p className="text-[12px] text-[#45464d] mt-1">
              Deterministic cryptographically bound guardrails. 0 unverified transactions allowed.
            </p>
          </div>
          <div className="pt-2 border-t border-[#c6c6cd]/20 flex items-center justify-between text-[11px] font-mono text-[#76777d]">
            <span>Enforcing Core: v2.4.19</span>
            <span className="text-[#009668]">STATUS: OPTIMAL</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="p-5 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <span className="text-[12px] font-medium text-[#76777d]">
              Enclave Evaluation Latency
            </span>
            <span className="material-symbols-outlined text-[#0051d5] text-[20px]">
              speed
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-lg text-[26px] font-semibold text-[#0b1c30]">
                8.4ms
              </span>
              <span className="font-mono text-[11px] text-[#0051d5] font-medium">
                P99: 11.2ms
              </span>
            </div>
            <p className="text-[12px] text-[#45464d] mt-1">
              Hardware-isolated AWS Nitro Enclave executing zero-knowledge policy proofs.
            </p>
          </div>
          <div className="pt-2 border-t border-[#c6c6cd]/20 flex items-center justify-between text-[11px] font-mono text-[#76777d]">
            <span>Sub-15ms Target</span>
            <span className="text-[#0051d5]">IN BOUNDS</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="p-5 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <span className="text-[12px] font-medium text-[#76777d]">
              Total Agent Spend (24h)
            </span>
            <span className="material-symbols-outlined text-[#76777d] text-[20px]">
              account_balance_wallet
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-lg text-[26px] font-semibold text-[#0b1c30]">
                ₹12,470
              </span>
              <span className="font-mono text-[11px] text-[#76777d]">
                / ₹17,000 Cap
              </span>
            </div>
            <div className="w-full bg-[#eff4ff] h-1.5 rounded-full overflow-hidden mt-2.5">
              <div
                className="bg-[#0051d5] h-full rounded-full transition-all"
                style={{ width: '73%' }}
              ></div>
            </div>
          </div>
          <div className="pt-2 border-t border-[#c6c6cd]/20 flex items-center justify-between text-[11px] font-mono text-[#76777d]">
            <span>{activeAgentsCount} Active Agent Keys</span>
            <span>73% Budget Deployed</span>
          </div>
        </div>
      </div>

      {/* Main Section: Real-time Authorization Feed */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#009668] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#009668]"></span>
            </span>
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Real-time Authorization Feed
            </h2>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#45464d]">
              24h Enclave Log
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateTab('security')}
              className="px-3 py-1.5 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">verified_user</span>
              <span>Audit Trail</span>
            </button>
            <button
              onClick={() => onNavigateTab('transactions')}
              className="px-3 py-1.5 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
              <span>Inspect Decisions</span>
            </button>
          </div>
        </div>

        {/* Hourly Volume Visualizer Bar Chart */}
        <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/25">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#76777d] mb-3">
            <span>Enclave Verification Volume · Hourly Distribution</span>
            <span>Peak: 12:00–13:00 IST (4 Txns)</span>
          </div>
          <div className="grid grid-cols-12 gap-2 h-14 items-end">
            {[15, 25, 10, 45, 20, 60, 35, 80, 50, 95, 70, 30].map((val, idx) => (
              <div key={idx} className="flex flex-col items-center gap-1 group">
                <div
                  className={`w-full rounded-t transition-all ${
                    idx === 9
                      ? 'bg-[#0051d5]'
                      : idx === 10
                      ? 'bg-[#316bf3]'
                      : 'bg-[#cbdbf5] hover:bg-[#0051d5]'
                  }`}
                  style={{ height: `${val}%` }}
                ></div>
                <span className="text-[9px] font-mono text-[#76777d] group-hover:text-[#0b1c30]">
                  {idx * 2}h
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-[#c6c6cd]/30 text-[11px] font-mono text-[#76777d] uppercase tracking-wider">
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Agent</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-3">Decision</th>
                <th className="py-2.5 px-3 text-right">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c6c6cd]/20 font-body-sm">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-[#eff4ff]/50 transition-colors">
                  <td className="py-3 px-3 font-mono text-[12px] text-[#76777d]">
                    {tx.time}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${tx.agentColor}`}></span>
                      <span className="font-medium text-[#0b1c30]">{tx.agent}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-[#45464d]">{tx.action}</td>
                  <td className="py-3 px-3 font-mono font-medium text-[#0b1c30]">
                    {tx.amount}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`font-mono text-[11px] px-2 py-0.5 rounded font-semibold ${
                        tx.decision === 'ALLOW'
                          ? 'bg-[#eff4ff] text-[#009668] border border-[#009668]/30'
                          : 'bg-[#ffdad6] text-[#93000a] border border-[#ba1a1a]/30 animate-pulse'
                      }`}
                    >
                      {tx.decision}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    {tx.verificationType === 'violation' ? (
                      <button
                        onClick={() => onNavigateTab('violation')}
                        className="text-[#93000a] font-mono text-[11px] font-semibold hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <span>Exceeds Scope</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenProof(tx)}
                        className="text-[#0051d5] font-mono text-[11px] hover:underline cursor-pointer inline-flex items-center gap-1"
                      >
                        <span>View Proof</span>
                        <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Agent Delegation Hierarchy Preview */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Active Agent Authority &amp; Delegation Matrix
            </h3>
            <p className="text-[12px] text-[#76777d] mt-0.5">
              Live cryptographic delegation lineages actively recognized by the Bound Enclave.
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('agents')}
            className="text-[12px] text-[#0051d5] hover:underline font-medium flex items-center gap-1 cursor-pointer"
          >
            <span>Manage All Agents</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => onNavigateTab('agents')}
              className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 hover:border-[#0051d5]/50 transition-all cursor-pointer space-y-2.5 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      agent.status === 'ACTIVE'
                        ? 'bg-[#009668]'
                        : agent.status === 'REVOKED'
                        ? 'bg-[#ba1a1a]'
                        : 'bg-[#76777d]'
                    }`}
                  ></div>
                  <span className="font-headline-sm text-[14px] font-semibold text-[#0b1c30] group-hover:text-[#0051d5] transition-colors">
                    {agent.name}
                  </span>
                </div>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#ffffff] text-[#45464d] border border-[#c6c6cd]/30">
                  {agent.status}
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] text-[#45464d]">
                <div className="flex justify-between">
                  <span className="text-[#76777d]">Creator:</span>
                  <span>{agent.creator}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#76777d]">Cap:</span>
                  <span className="font-medium text-[#0b1c30]">{agent.cap}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#76777d]">Scope:</span>
                  <span className="truncate max-w-[120px]">{agent.scopeSummary}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-[#c6c6cd]/20 flex items-center justify-between text-[10px] font-mono text-[#76777d]">
                <span>{agent.runtimeId}</span>
                <span className="flex items-center gap-1 text-[#0051d5]">
                  <span>Inspect</span>
                  <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
