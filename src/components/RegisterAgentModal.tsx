import React, { useState } from 'react';
import { AgentNode } from '../types';

interface RegisterAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterAgent: (agent: AgentNode) => void;
  onRegisterAgentApi?: (payload: { name: string; description?: string; capAmount?: number; mccList?: string }) => Promise<void>;
}

export const RegisterAgentModal: React.FC<RegisterAgentModalProps> = ({ isOpen, onClose, onRegisterAgent, onRegisterAgentApi }) => {
  const [name, setName] = useState('');
  const [capAmount, setCapAmount] = useState('5000');
  const [mccList, setMccList] = useState('5411, 5812');
  const [allowDelegation, setAllowDelegation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (onRegisterAgentApi) {
        await onRegisterAgentApi({
          name: name.trim(),
          capAmount: parseFloat(capAmount) || 5000,
          mccList,
        });
      } else {
        const capNum = parseFloat(capAmount) || 5000;
        const randomHex = Math.random().toString(36).substring(2, 9);
        const newAgent: AgentNode = {
          id: `agt-${Date.now()}`,
          name: name.trim(),
          runtimeId: `agt_${randomHex}`,
          status: 'ACTIVE',
          creator: 'Root Vault',
          creatorSub: '#492 (You)',
          cap: `₹${capNum.toLocaleString()}`,
          scopeSummary: `Custom MCCs: ${mccList}`,
          heartbeat: 'Just now',
          heartbeatCode: 'sec_auth',
          authorizedAmount: capNum,
          requestedAmount: 0,
          remainingHeadroom: capNum,
          policy: 'HARD_STOP_AT_100%',
          hash: `sha256:${Math.random().toString(36).substring(2, 8)}…`,
          mccAllowed: mccList.split(',').map((c) => `MCC ${c.trim()}`),
          expiryDate: '31 Dec 2026',
          velocityLimit: 'Max 5 Tx / 24h',
          canSubDelegate: allowDelegation,
          delegationTarget: allowDelegation ? 'Downstream Virtual Tokenizer' : undefined,
          purpose: `${name.trim()} automated spending envelope governed by Bound Enclave`,
        };
        onRegisterAgent(newAgent);
      }
      setName('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#213145]/40 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-[#ffffff] rounded-xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-4 border border-[#c6c6cd]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0051d5] text-[22px]">vpn_key</span>
            <h3 className="font-headline-lg text-[20px] text-[#0b1c30] font-semibold">Provision Agent API Key</h3>
          </div>
          <button onClick={onClose} className="text-[#45464d] hover:text-[#0b1c30] cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <p className="font-body-sm text-[12px] text-[#45464d] leading-relaxed">
          Generate a scoped cryptographic keypair for autonomous agent initiation. Every request must carry an enclave signature.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#0b1c30] font-medium">Agent Descriptor Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Inventory Logistics Agent"
              required
              className="px-3 py-2 bg-[#eff4ff] rounded font-body-md text-[13px] text-[#0b1c30] placeholder:text-[#76777d] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Hard Spending Limit (INR)</label>
              <input
                type="number"
                value={capAmount}
                onChange={(e) => setCapAmount(e.target.value)}
                placeholder="5000"
                required
                className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">MCC Allowed Whitelist</label>
              <input
                value={mccList}
                onChange={(e) => setMccList(e.target.value)}
                placeholder="5411, 5812"
                required
                className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="allow-delegation-cb"
              checked={allowDelegation}
              onChange={(e) => setAllowDelegation(e.target.checked)}
              className="rounded w-4 h-4 text-[#000000] cursor-pointer"
            />
            <label htmlFor="allow-delegation-cb" className="font-body-sm text-[12px] text-[#0b1c30] cursor-pointer select-none">
              Permit this agent to sub-delegate execution to downstream micro-agents
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#c6c6cd]/20">
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded text-[12px] font-medium text-[#0b1c30] hover:bg-[#dce9ff] transition-colors cursor-pointer disabled:opacity-60">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded text-[12px] font-medium bg-[#000000] text-[#ffffff] hover:bg-[#213145] transition-all cursor-pointer shadow-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">{submitting ? 'hourglass_empty' : 'add_moderator'}</span>
              <span>{submitting ? 'Provisioning…' : 'Issue Key & Enforce'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
