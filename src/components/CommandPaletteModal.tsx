import React, { useState, useEffect, useRef } from 'react';
import { AgentNode, MandateItem, TransactionRecord, ActiveTab } from '../types';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentNode[];
  mandates: MandateItem[];
  transactions: TransactionRecord[];
  onSelectTab: (tab: ActiveTab) => void;
  onOpenProof: (tx: TransactionRecord) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  agents,
  mandates,
  transactions,
  onSelectTab,
  onOpenProof,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const q = query.toLowerCase();

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.runtimeId.toLowerCase().includes(q) ||
      a.scopeSummary.toLowerCase().includes(q)
  );

  const filteredMandates = mandates.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q) ||
      m.mccCode.toLowerCase().includes(q) ||
      m.boundAgent.toLowerCase().includes(q)
  );

  const filteredTxs = transactions.filter(
    (t) =>
      t.id.toLowerCase().includes(q) ||
      t.merchant.toLowerCase().includes(q) ||
      t.action.toLowerCase().includes(q) ||
      t.agent.toLowerCase().includes(q)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#131b2e]/60 p-4 pt-20 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-[#ffffff] shadow-2xl overflow-hidden border border-[#c6c6cd]/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-[#c6c6cd]/30 gap-2">
          <span className="material-symbols-outlined text-[#76777d]">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, mandates, cryptographic hashes, MCCs..."
            className="w-full bg-transparent text-[14px] text-[#0b1c30] placeholder:text-[#76777d] outline-none"
          />
          <kbd className="px-2 py-0.5 rounded bg-[#eff4ff] border border-[#c6c6cd]/40 font-mono text-[11px] text-[#76777d]">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-[#c6c6cd]/20">
          {/* Quick Navigation Section */}
          <div className="py-2">
            <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-[#76777d]">
              Views &amp; Enclaves
            </span>
            <div className="mt-1 flex flex-col gap-0.5">
              <button
                onClick={() => {
                  onSelectTab('overview');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#eff4ff] text-left text-[13px] text-[#0b1c30] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0051d5]">
                    dashboard
                  </span>
                  <span>Overview Dashboard</span>
                </div>
                <span className="font-mono text-[11px] text-[#76777d]">Real-time Feed</span>
              </button>

              <button
                onClick={() => {
                  onSelectTab('agents');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#eff4ff] text-left text-[13px] text-[#0b1c30] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0051d5]">
                    smart_toy
                  </span>
                  <span>Agents &amp; Delegation Matrix</span>
                </div>
                <span className="font-mono text-[11px] text-[#76777d]">4 Nodes</span>
              </button>

              <button
                onClick={() => {
                  onSelectTab('mandates');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#eff4ff] text-left text-[13px] text-[#0b1c30] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0051d5]">
                    policy
                  </span>
                  <span>Spending Mandates</span>
                </div>
                <span className="font-mono text-[11px] text-[#76777d]">Contracts</span>
              </button>

              <button
                onClick={() => {
                  onSelectTab('transactions');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#eff4ff] text-left text-[13px] text-[#0b1c30] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0051d5]">
                    receipt_long
                  </span>
                  <span>Payment Decision Verification</span>
                </div>
                <span className="font-mono text-[11px] text-[#76777d]">Active Eval</span>
              </button>

              <button
                onClick={() => {
                  onSelectTab('security');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#eff4ff] text-left text-[13px] text-[#0b1c30] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#009668]">
                    verified_user
                  </span>
                  <span>Security &amp; Provenance Audit</span>
                </div>
                <span className="font-mono text-[11px] text-[#76777d]">Merkle Path</span>
              </button>

              <button
                onClick={() => {
                  onSelectTab('violation');
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#ffdad6]/40 text-left text-[13px] text-[#93000a] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#ba1a1a]">
                    warning
                  </span>
                  <span>Security Intercept / Policy Violation Detected</span>
                </div>
                <span className="font-mono text-[11px] text-[#ba1a1a]">SEC-8820</span>
              </button>
            </div>
          </div>

          {/* Filtered Agents */}
          {filteredAgents.length > 0 && (
            <div className="py-2">
              <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-[#76777d]">
                Agents ({filteredAgents.length})
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {filteredAgents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      onSelectTab('agents');
                      onClose();
                    }}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-[#eff4ff] text-left text-[12px] text-[#0b1c30] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          a.status === 'ACTIVE'
                            ? 'bg-[#009668]'
                            : a.status === 'REVOKED'
                            ? 'bg-[#ba1a1a]'
                            : 'bg-[#76777d]'
                        }`}
                      ></span>
                      <span className="font-medium">{a.name}</span>
                      <code className="text-[#76777d] font-mono text-[10px]">{a.runtimeId}</code>
                    </div>
                    <span className="font-mono text-[11px]">{a.cap}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtered Mandates */}
          {filteredMandates.length > 0 && (
            <div className="py-2">
              <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-[#76777d]">
                Mandates ({filteredMandates.length})
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {filteredMandates.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectTab('mandates');
                      onClose();
                    }}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-[#eff4ff] text-left text-[12px] text-[#0b1c30] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] px-1 rounded bg-[#eff4ff] text-[#45464d]">
                        {m.code}
                      </span>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-[#76777d] text-[11px]">({m.boundAgent})</span>
                    </div>
                    <span className="font-mono text-[11px]">₹{m.cap.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtered Transactions */}
          {filteredTxs.length > 0 && (
            <div className="py-2">
              <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-[#76777d]">
                Transactions ({filteredTxs.length})
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {filteredTxs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.verificationType === 'violation') {
                        onSelectTab('violation');
                      } else {
                        onOpenProof(t);
                      }
                      onClose();
                    }}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-[#eff4ff] text-left text-[12px] text-[#0b1c30] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-[#76777d]">{t.time}</span>
                      <span className="font-medium">{t.action}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{t.amount}</span>
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          t.decision === 'ALLOW'
                            ? 'bg-[#eff4ff] text-[#009668]'
                            : 'bg-[#ffdad6] text-[#93000a]'
                        }`}
                      >
                        {t.decision}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
