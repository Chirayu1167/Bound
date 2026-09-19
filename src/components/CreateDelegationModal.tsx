import React, { useEffect, useMemo, useState } from 'react';
import { AgentNode, MandateItem } from '../types';
import { Modal, inputClass, labelClass } from './ui';

interface CreateDelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentNode[];
  mandates: MandateItem[];
  onCreate: (payload: { parent_agent_id: string; child_agent_id: string; parent_mandate_id: string; delegated_amount_limit: number; purpose: string; merchant_category: string; expires_at?: string | null }) => Promise<void>;
}

export const CreateDelegationModal: React.FC<CreateDelegationModalProps> = ({ isOpen, onClose, agents, mandates, onCreate }) => {
  const activeAgents = useMemo(() => agents.filter((a) => a.status === 'ACTIVE' && !a.is_task_agent), [agents]);
  const [parentId, setParentId] = useState(activeAgents[0]?.id || '');
  const [childId, setChildId] = useState(activeAgents[1]?.id || activeAgents[0]?.id || '');
  const [mandateId, setMandateId] = useState('');
  const [amount, setAmount] = useState('1000');
  const [purpose, setPurpose] = useState('');
  const [category, setCategory] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parentMandates = useMemo(() => mandates.filter((m) => {
    const agent = agents.find((a) => a.id === parentId);
    return agent ? m.agent_id === parentId && m.status === 'ACTIVE' : false;
  }), [mandates, parentId, agents]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeAgents.length > 0) {
      if (!activeAgents.find((a) => a.id === parentId)) setParentId(activeAgents[0].id);
      const childOptions = activeAgents.filter((a) => a.id !== parentId);
      if (childOptions.length > 0 && !childOptions.find((a) => a.id === childId)) setChildId(childOptions[0].id);
    }
  }, [isOpen, agents, activeAgents, parentId, childId]);

  useEffect(() => {
    if (parentMandates.length > 0 && !parentMandates.find((m) => m.id === mandateId)) {
      const first = parentMandates[0];
      setMandateId(first.id);
      setAmount(String(Math.min(1000, first.max_amount)));
      setPurpose(first.purpose);
      setCategory(first.merchant_category);
    }
  }, [parentMandates, mandateId]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parentId || !childId || !mandateId) {
      setError('Select a parent agent, a child agent, and the parent rule.');
      return;
    }
    if (parentId === childId) {
      setError('Parent and child must be different agents.');
      return;
    }
    const limit = parseFloat(amount);
    if (!limit || limit <= 0) {
      setError('Enter a delegated limit greater than zero.');
      return;
    }
    let expiresIso: string | null = null;
    if (expiryDate) {
      const d = new Date(expiryDate + 'T23:59:59');
      if (isNaN(d.getTime())) {
        setError('Pick a valid expiry date, or leave it empty.');
        return;
      }
      expiresIso = d.toISOString();
    }
    setSubmitting(true);
    try {
      await onCreate({
        parent_agent_id: parentId,
        child_agent_id: childId,
        parent_mandate_id: mandateId,
        delegated_amount_limit: limit,
        purpose: purpose.trim() || 'Delegated spending',
        merchant_category: category.trim() || 'General',
        expires_at: expiresIso,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create the delegation.');
    } finally {
      setSubmitting(false);
    }
  };

  const childOptions = activeAgents.filter((a) => a.id !== parentId);

  return (
    <Modal onClose={onClose}>
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">New delegation</h3>
      <p className="text-[13px] text-[#5a5c63] mt-1">How much authority is passed from one agent to another? The child can never exceed the parent rule.</p>
      {error && <p className="mt-3 text-[13px] text-[#93000a] bg-[#fdf3f2] border border-[#e8c4c0] rounded-lg px-3 py-2">{error}</p>}
      {activeAgents.length < 2 ? (
        <p className="mt-4 text-[13px] text-[#76777d]">You need at least two active agents to create a delegation.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3.5 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass()}>From (parent)</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()}>To (child)</label>
              <select value={childId} onChange={(e) => setChildId(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
                {childOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass()}>Parent rule</label>
            <select value={mandateId} onChange={(e) => setMandateId(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
              {parentMandates.length === 0 && <option value="">No active rule for this parent</option>}
              {parentMandates.map((m) => (
                <option key={m.id} value={m.id}>{m.purpose} — ₹{m.max_amount.toLocaleString()} · {m.merchant_category}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass()}>Delegated limit (₹)</label>
              <input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass()} mt-1`} />
            </div>
            <div>
              <label className={labelClass()}>Expires (optional)</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={`${inputClass()} mt-1`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass()}>Purpose</label>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Groceries" className={`${inputClass()} mt-1`} />
            </div>
            <div>
              <label className={labelClass()}>Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Grocery" className={`${inputClass()} mt-1`} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#0b1c30] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
              {submitting ? 'Creating…' : 'Create delegation'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
