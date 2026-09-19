import React, { useState, useEffect } from 'react';
import { MandateItem, AgentNode } from '../types';

interface CreateMandateModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentNode[];
  onSaveMandate: (mandate: MandateItem) => void;
  onCreateMandateApi?: (payload: { agent_id: string; purpose: string; max_amount: number; merchant_category: string; expires_at?: string | null }) => Promise<void>;
}

export const CreateMandateModal: React.FC<CreateMandateModalProps> = ({ isOpen, onClose, agents, onSaveMandate, onCreateMandateApi }) => {
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id || 'shopping-agent');
  const [capAmount, setCapAmount] = useState('2000');
  const [mccScope, setMccScope] = useState('MCC 5411');
  const [scopeTitle, setScopeTitle] = useState('Supermarkets, Food & Daily Provisions');
  const [expiry, setExpiry] = useState('Expires 30 Nov 2026');
  const [subDelegation, setSubDelegation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (agents.length > 0 && !agents.find((a) => a.id === agentId)) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (onCreateMandateApi) {
        const mccRaw = mccScope.replace(/^MCC\s*/i, '').trim() || mccScope.trim() || 'Grocery';
        let expiresIso: string | null = null;
        if (expiry && !expiry.toLowerCase().includes('no expiry')) {
          const cleaned = expiry.replace(/^Expires\s*/i, '');
          const parsed = Date.parse(cleaned);
          if (!isNaN(parsed)) expiresIso = new Date(parsed).toISOString();
          else {
            // Try appending current year if missing
            const withYear = Date.parse(`${cleaned} 2026`);
            if (!isNaN(withYear)) expiresIso = new Date(withYear).toISOString();
          }
        }
        await onCreateMandateApi({
          agent_id: agentId,
          purpose: name.trim(),
          max_amount: parseFloat(capAmount) || 2000,
          merchant_category: mccRaw,
          expires_at: expiresIso,
        });
        setName('');
        onClose();
      } else {
        // Fallback to old local construction for Phase 1 compatibility
        const capNum = parseFloat(capAmount) || 2000;
        const agentName = agents.find((a) => a.id === agentId)?.name || agentId;
        const newMandate: MandateItem = {
          id: `mnd-${Math.floor(1000 + Math.random() * 9000)}`,
          code: `MND-${Math.floor(1000 + Math.random() * 9000)}`,
          name: name.trim(),
          expiry: expiry,
          spent: 0,
          cap: capNum,
          safeBuffer: `₹${capNum.toLocaleString()} Safe Buffer Remaining`,
          boundAgent: agentName,
          subDelegationNote: subDelegation ? 'Sub-delegation permitted' : 'Solo execution',
          agentHash: `sha256:${Math.random().toString(36).substring(2, 8)}…${Math.random().toString(36).substring(2, 5)}`,
          permittedScopeTitle: scopeTitle,
          mccCode: mccScope,
          mccDetail: 'Enclave Verified',
          status: 'ACTIVE',
        };
        onSaveMandate(newMandate);
        setName('');
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 animate-in fade-in">
      <div className="w-full max-w-lg rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-4 border border-[#c6c6cd]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0051d5] text-[22px]">policy</span>
            <h3 className="font-headline-lg text-[20px] text-[#0b1c30] font-semibold">Issue New Spending Mandate</h3>
          </div>
          <button onClick={onClose} className="text-[#45464d] hover:text-[#0b1c30] cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <p className="font-body-sm text-[12px] text-[#45464d]">Generate an unforgeable permission contract signed with your vault root key.</p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#0b1c30] font-medium">Mandate Descriptor Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Cloud Burst Computing, Office Supplies"
              required
              className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] placeholder:text-[#76777d] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Bound Agent Node</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff] cursor-pointer"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Maximum Cap (INR)</label>
              <input
                type="number"
                value={capAmount}
                onChange={(e) => setCapAmount(e.target.value)}
                required
                className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Merchant Category Code (MCC)</label>
              <input
                value={mccScope}
                onChange={(e) => setMccScope(e.target.value)}
                placeholder="MCC 5411, MCC 5732"
                required
                className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-[#0b1c30] font-medium">Expiry Notice</label>
              <input
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                placeholder="Expires 31 Dec 2026"
                className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#0b1c30] font-medium">Permitted Scope Classification</label>
            <input
              value={scopeTitle}
              onChange={(e) => setScopeTitle(e.target.value)}
              placeholder="e.g. AWS & Google Cloud Virtual Compute Hosting"
              className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="mandate-subdelegate"
              checked={subDelegation}
              onChange={(e) => setSubDelegation(e.target.checked)}
              className="rounded w-4 h-4 text-[#000000] cursor-pointer"
            />
            <label htmlFor="mandate-subdelegate" className="text-[12px] text-[#0b1c30] cursor-pointer select-none">
              Permit sub-delegation to downstream payment execution bots
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#c6c6cd]/20">
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded text-[12px] font-medium text-[#0b1c30] hover:bg-[#e5eeff] transition-colors cursor-pointer disabled:opacity-60">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded text-[12px] font-medium bg-[#000000] text-[#ffffff] hover:opacity-90 transition-opacity cursor-pointer shadow-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">{submitting ? 'hourglass_empty' : 'verified'}</span>
              <span>{submitting ? 'Signing…' : 'Sign & Issue Mandate'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
