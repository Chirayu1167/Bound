import React, { useState, useEffect } from 'react';
import { AgentNode, MandateItem } from '../types';

interface CreateDelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentNode[];
  mandates: MandateItem[];
  onCreate: (payload: { parent_agent_id: string; child_agent_id: string; parent_mandate_id: string; delegated_amount_limit: number; purpose: string; merchant_category: string; expires_at?: string | null }) => Promise<void>;
}

export const CreateDelegationModal: React.FC<CreateDelegationModalProps> = ({ isOpen, onClose, agents, mandates, onCreate }) => {
  const [parentAgentId, setParentAgentId] = useState(agents.find((a) => a.id === 'shopping-agent')?.id || agents[0]?.id || '');
  const [childAgentId, setChildAgentId] = useState(agents.find((a) => a.id === 'payment-agent')?.id || agents[1]?.id || '');
  const [parentMandateId, setParentMandateId] = useState('');
  const [amount, setAmount] = useState('1000');
  const [purpose, setPurpose] = useState('Groceries');
  const [merchantCategory, setMerchantCategory] = useState('Grocery');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select first mandate for parent
  const parentMandates = mandates.filter((m) => {
    const agent = agents.find((a) => a.id === parentAgentId);
    return agent ? m.boundAgent === agent.name && m.status === 'ACTIVE' : false;
  });

  useEffect(() => {
    if (parentMandates.length > 0 && !parentMandates.find((m) => m.id === parentMandateId)) {
      setParentMandateId(parentMandates[0].id);
      // Prefill amount/purpose from mandate
      setAmount(String(Math.min(1000, parentMandates[0].cap)));
      setPurpose(parentMandates[0].name);
      const cat = parentMandates[0].mccCode.replace(/^MCC\s*/i, '');
      setMerchantCategory(cat || 'Grocery');
    }
  }, [parentAgentId, mandates, agents, parentMandateId, parentMandates]);

  // Keep child != parent
  useEffect(() => {
    if (childAgentId === parentAgentId && agents.length > 1) {
      const other = agents.find((a) => a.id !== parentAgentId);
      if (other) setChildAgentId(other.id);
    }
  }, [parentAgentId, childAgentId, agents]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parentAgentId || !childAgentId || !parentMandateId) {
      setError('Select parent, child and mandate.');
      return;
    }
    if (parentAgentId === childAgentId) {
      setError('Parent and child must be different.');
      return;
    }
    setSubmitting(true);
    try {
      let expiresIso: string | null = null;
      if (expiresAt.trim()) {
        const parsed = Date.parse(expiresAt);
        if (isNaN(parsed)) {
          setError('Invalid expiry date.');
          setSubmitting(false);
          return;
        }
        expiresIso = new Date(parsed).toISOString();
      }
      await onCreate({
        parent_agent_id: parentAgentId,
        child_agent_id: childAgentId,
        parent_mandate_id: parentMandateId,
        delegated_amount_limit: parseFloat(amount) || 0,
        purpose: purpose.trim(),
        merchant_category: merchantCategory.trim(),
        expires_at: expiresIso,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create delegation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 animate-in fade-in">
      <div className="w-full max-w-lg rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-4 border border-[#c6c6cd]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0051d5] text-[22px]">account_tree</span>
            <h3 className="font-headline-lg text-[20px] text-[#0b1c30] font-semibold">Create Delegation</h3>
          </div>
          <button onClick={onClose} className="text-[#45464d] hover:text-[#0b1c30] cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <p className="font-body-sm text-[12px] text-[#45464d]">
          Delegate a bounded subset of authority. Child limit and purpose must be <span className="font-semibold text-[#0b1c30]">≤ parent</span>.
        </p>

        {error && <div className="p-2 rounded bg-[#ffdad6] border border-[#ba1a1a]/30 text-[#93000a] text-[12px] font-mono">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Parent Agent (A)</label>
              <select value={parentAgentId} onChange={(e) => setParentAgentId(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] cursor-pointer">
                {agents
                  .filter((a) => a.status === 'ACTIVE')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.status})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Child Agent (B)</label>
              <select value={childAgentId} onChange={(e) => setChildAgentId(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] cursor-pointer">
                {agents
                  .filter((a) => a.id !== parentAgentId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.status})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#0b1c30] font-medium">Parent Mandate</label>
            <select value={parentMandateId} onChange={(e) => setParentMandateId(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] cursor-pointer">
              {parentMandates.length === 0 && <option value="">No active mandate for parent</option>}
              {parentMandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name} (₹{m.cap.toLocaleString()} {m.mccCode})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-[#76777d] font-mono">Root mandate that authorizes the parent. Child ⊆ parent.</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Delegated Limit (INR)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Expires At (optional)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Purpose</label>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} required placeholder="Groceries" className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Merchant Category</label>
              <input value={merchantCategory} onChange={(e) => setMerchantCategory(e.target.value)} required placeholder="Grocery" className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#c6c6cd]/20">
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded text-[12px] font-medium text-[#0b1c30] hover:bg-[#e5eeff] transition-colors cursor-pointer disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded text-[12px] font-medium bg-[#000000] text-[#ffffff] hover:opacity-90 transition-opacity cursor-pointer shadow-sm flex items-center gap-1.5 disabled:opacity-60">
              <span className="material-symbols-outlined text-[16px]">{submitting ? 'hourglass_empty' : 'account_tree'}</span>
              <span>{submitting ? 'Delegating…' : 'Create Delegation'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
