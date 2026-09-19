import React, { useState } from 'react';
import { AgentNode } from '../types';

interface AgentsViewProps {
  agents: AgentNode[];
  onOpenRegisterModal: () => void;
  onRevokeAgent: (agentId: string) => void;
  onRotateSignature: (agentId: string) => void;
}

export const AgentsView: React.FC<AgentsViewProps> = ({
  agents,
  onOpenRegisterModal,
  onRevokeAgent,
  onRotateSignature,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agents[0]?.id || 'shopping-agent');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">
            Enclave Key Provisioning &amp; Delegation Tree
          </span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">
            Agents &amp; Delegation
          </h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">
            Provision runtime credentials and audit cryptographic capability chains.
          </p>
        </div>

        <button
          onClick={onOpenRegisterModal}
          className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[16px]">vpn_key</span>
          <span>Register Agent Key</span>
        </button>
      </div>

      {/* 2-Column Inspector Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Agent Directory List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider">
              Enrolled Runtimes ({agents.length})
            </span>
            <span className="text-[11px] text-[#76777d]">Hardware Enclave</span>
          </div>

          <div className="space-y-2">
            {agents.map((agent) => {
              const isSelected = agent.id === selectedAgent?.id;
              const isRevoked = agent.status === 'REVOKED';

              return (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#ffffff] border-[#0051d5] shadow-sm ring-1 ring-[#0051d5]'
                      : 'bg-[#ffffff] border-[#c6c6cd]/30 hover:border-[#0051d5]/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          agent.status === 'ACTIVE'
                            ? 'bg-[#009668]'
                            : isRevoked
                            ? 'bg-[#ba1a1a]'
                            : 'bg-[#76777d]'
                        }`}
                      ></div>
                      <div>
                        <h4 className="font-headline-sm text-[15px] font-semibold text-[#0b1c30]">
                          {agent.name}
                        </h4>
                        <code className="text-[11px] font-mono text-[#76777d]">
                          {agent.runtimeId}
                        </code>
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                        agent.status === 'ACTIVE'
                          ? 'bg-[#eff4ff] text-[#009668]'
                          : isRevoked
                          ? 'bg-[#ffdad6] text-[#93000a]'
                          : 'bg-[#eff4ff] text-[#76777d]'
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[#c6c6cd]/20 grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <span className="text-[#76777d] block text-[10px]">Cap / Limit:</span>
                      <span className="font-medium text-[#0b1c30]">{agent.cap}</span>
                    </div>
                    <div>
                      <span className="text-[#76777d] block text-[10px]">Creator:</span>
                      <span className="text-[#45464d] truncate block">{agent.creator}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Agent Inspector (7 cols) */}
        {selectedAgent && (
          <div className="lg:col-span-7 space-y-6">
            <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-6">
              {/* Top Banner Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#c6c6cd]/20">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-headline-lg text-[22px] text-[#0b1c30] font-semibold">
                      {selectedAgent.name}
                    </h2>
                    <span
                      className={`font-mono text-[11px] px-2 py-0.5 rounded font-semibold ${
                        selectedAgent.status === 'ACTIVE'
                          ? 'bg-[#eff4ff] text-[#009668]'
                          : selectedAgent.status === 'REVOKED'
                          ? 'bg-[#ffdad6] text-[#93000a]'
                          : 'bg-[#eff4ff] text-[#76777d]'
                      }`}
                    >
                      {selectedAgent.status}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-[#76777d] mt-0.5">
                    Runtime: {selectedAgent.runtimeId} · Root Key {selectedAgent.hash}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onRotateSignature(selectedAgent.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1 border border-[#c6c6cd]/30"
                  >
                    <span className="material-symbols-outlined text-[16px]">cached</span>
                    <span>Rotate Key</span>
                  </button>
                  <button
                    onClick={() => onRevokeAgent(selectedAgent.id)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      selectedAgent.status === 'REVOKED'
                        ? 'bg-[#eff4ff] text-[#009668] hover:bg-[#dce9ff]'
                        : 'bg-[#ffdad6] text-[#93000a] hover:bg-[#ffb4ab]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {selectedAgent.status === 'REVOKED' ? 'restore' : 'gavel'}
                    </span>
                    <span>
                      {selectedAgent.status === 'REVOKED' ? 'Restore Key' : 'Sever Keypair'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Headroom / Balance Ratio Bar */}
              <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/25 space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#76777d] font-medium">Autonomous Balance Allocation</span>
                  <span className="font-mono text-[11px] text-[#0051d5]">
                    Policy: {selectedAgent.policy}
                  </span>
                </div>

                <div className="flex items-baseline justify-between font-mono">
                  <div>
                    <span className="text-[18px] font-semibold text-[#0b1c30]">
                      ₹{selectedAgent.requestedAmount.toLocaleString()}
                    </span>
                    <span className="text-[12px] text-[#76777d]"> Spent</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[14px] font-semibold text-[#009668]">
                      ₹{selectedAgent.remainingHeadroom.toLocaleString()}
                    </span>
                    <span className="text-[12px] text-[#76777d]"> Headroom</span>
                  </div>
                </div>

                <div className="w-full bg-[#e5eeff] h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      selectedAgent.status === 'REVOKED' ? 'bg-[#76777d]' : 'bg-[#0051d5]'
                    }`}
                    style={{
                      width: `${
                        selectedAgent.authorizedAmount > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (selectedAgent.requestedAmount /
                                  selectedAgent.authorizedAmount) *
                                  100
                              )
                            )
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>
              </div>

              {/* Three-Tier Delegation Chain Visualizer */}
              <div className="space-y-3">
                <h3 className="font-headline-sm text-[15px] text-[#0b1c30] font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#0051d5] text-[18px]">
                    account_tree
                  </span>
                  <span>Cryptographic Delegation Lineage</span>
                </h3>

                <div className="p-4 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 space-y-3 font-mono text-[11px]">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#000000] text-[#ffffff] flex items-center justify-center text-[10px] shrink-0">
                      1
                    </div>
                    <div>
                      <span className="font-semibold text-[#0b1c30]">Acme Root Vault KMS</span>
                      <span className="text-[#76777d] block">
                        Principal #492 (Human Signature via WebAuthn)
                      </span>
                    </div>
                  </div>

                  <div className="ml-3 pl-3 border-l-2 border-[#c6c6cd]/40 py-1">
                    <span className="text-[#0051d5] font-semibold">
                      ↓ Delegated Mandate Token
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#0051d5] text-[#ffffff] flex items-center justify-center text-[10px] shrink-0">
                      2
                    </div>
                    <div>
                      <span className="font-semibold text-[#0b1c30]">
                        {selectedAgent.name} (This Agent)
                      </span>
                      <span className="text-[#76777d] block">
                        Hardware Nitro Enclave ({selectedAgent.runtimeId})
                      </span>
                    </div>
                  </div>

                  {selectedAgent.canSubDelegate && (
                    <>
                      <div className="ml-3 pl-3 border-l-2 border-[#c6c6cd]/40 py-1">
                        <span className="text-[#009668] font-semibold">
                          ↓ Sub-Delegated Micro-Token (Depth 2)
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#009668] text-[#ffffff] flex items-center justify-center text-[10px] shrink-0">
                          3
                        </div>
                        <div>
                          <span className="font-semibold text-[#0b1c30]">
                            {selectedAgent.delegationTarget || 'Downstream Payment Tokenizer'}
                          </span>
                          <span className="text-[#76777d] block">
                            Ephemeral Virtual Card Provisioner
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Authority & Scope Constraints */}
              <div className="space-y-3">
                <h3 className="font-headline-sm text-[15px] text-[#0b1c30] font-semibold">
                  Authority &amp; Scope Constraints
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
                  <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25 space-y-1">
                    <span className="text-[#76777d] text-[11px] block font-mono">
                      Permitted Merchant Category Codes:
                    </span>
                    {selectedAgent.mccAllowed.map((m, idx) => (
                      <span
                        key={idx}
                        className="inline-block px-2 py-0.5 rounded bg-[#ffffff] text-[#0b1c30] font-mono text-[11px] border border-[#c6c6cd]/30 mr-1.5 mt-1"
                      >
                        {m}
                      </span>
                    ))}
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#76777d]">Velocity Limit:</span>
                      <span className="text-[#0b1c30]">{selectedAgent.velocityLimit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#76777d]">Key Expiry:</span>
                      <span className="text-[#0b1c30]">{selectedAgent.expiryDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#76777d]">Sub-Delegation:</span>
                      <span
                        className={
                          selectedAgent.canSubDelegate ? 'text-[#009668]' : 'text-[#ba1a1a]'
                        }
                      >
                        {selectedAgent.canSubDelegate ? 'ENABLED (MAX DEPTH 3)' : 'BLOCKED'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
