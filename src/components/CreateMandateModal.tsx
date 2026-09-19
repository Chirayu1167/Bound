import React, { useEffect, useState } from 'react';
import { AgentNode } from '../types';
import { Modal, inputClass, labelClass } from './ui';

export interface MandateInitialValues {
  agentId?: string;
  purpose?: string;
  cap?: number;
  category?: string;
}

interface CreateMandateModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentNode[];
  onCreate: (payload: { agent_id: string; purpose: string; max_amount: number; merchant_category: string; expires_at?: string | null }) => Promise<void>;
  /** Optional prefill for guided flows (e.g. domain setup). All values stay editable. */
  initial?: MandateInitialValues | null;
}

const CATEGORIES = ['Grocery', 'Airlines', 'Dining', 'Fuel', 'General'];

export const CreateMandateModal: React.FC<CreateMandateModalProps> = ({ isOpen, onClose, agents, onCreate, initial }) => {
  const activeAgents = agents.filter((a) => a.status === 'ACTIVE' && !a.is_task_agent);
  const [agentId, setAgentId] = useState(activeAgents[0]?.id || '');
  const [purpose, setPurpose] = useState('Groceries');
  const [capAmount, setCapAmount] = useState('2000');
  const [category, setCategory] = useState('Grocery');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && activeAgents.length > 0 && !activeAgents.find((a) => a.id === agentId)) {
      setAgentId(activeAgents[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agents]);

  // Apply guided-flow prefill when the modal opens. Everything stays editable.
  const lastInitialNonce = React.useRef('');
  useEffect(() => {
    if (!isOpen || !initial) return;
    const key = JSON.stringify(initial);
    if (lastInitialNonce.current === key) return;
    lastInitialNonce.current = key;
    if (initial.agentId) setAgentId(initial.agentId);
    if (initial.purpose) setPurpose(initial.purpose);
    if (initial.cap !== undefined) setCapAmount(String(initial.cap));
    if (initial.category && CATEGORIES.includes(initial.category)) setCategory(initial.category);
    setError(null);
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agentId) {
      setError('Select an agent. Only active agents can receive a rule.');
      return;
    }
    const cap = parseFloat(capAmount);
    if (!cap || cap <= 0) {
      setError('Enter a limit greater than zero.');
      return;
    }
    if (!purpose.trim()) {
      setError('Describe what this rule is for.');
      return;
    }
    let expiresIso: string | null = null;
    if (expiryDate) {
      const d = new Date(expiryDate + 'T23:59:59');
      if (isNaN(d.getTime())) {
        setError('Pick a valid expiry date, or leave it empty for no expiry.');
        return;
      }
      expiresIso = d.toISOString();
    }
    setSubmitting(true);
    try {
      await onCreate({ agent_id: agentId, purpose: purpose.trim(), max_amount: cap, merchant_category: category, expires_at: expiresIso });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create the rule.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">New spending rule</h3>
      <p className="text-[13px] text-[#5a5c63] mt-1">How much can this agent spend, where, and until when?</p>
      {error && <p className="mt-3 text-[13px] text-[#93000a] bg-[#fdf3f2] border border-[#e8c4c0] rounded-lg px-3 py-2">{error}</p>}
      {activeAgents.length === 0 ? (
        <p className="mt-4 text-[13px] text-[#76777d]">There are no active agents. Register or restore an agent first.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3.5 mt-4">
          <div>
            <label className={labelClass()}>Agent</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass()}>What is this for? (purpose)</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Groceries" className={`${inputClass()} mt-1`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass()}>Limit (₹)</label>
              <input type="number" min="1" step="any" value={capAmount} onChange={(e) => setCapAmount(e.target.value)} className={`${inputClass()} mt-1`} />
            </div>
            <div>
              <label className={labelClass()}>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass()}>Expires (optional)</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={`${inputClass()} mt-1`} />
            <p className="text-[12px] text-[#76777d] mt-1">Leave empty for no expiry. Payments after this date will need review.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#0b1c30] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
              {submitting ? 'Creating…' : 'Create rule'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
