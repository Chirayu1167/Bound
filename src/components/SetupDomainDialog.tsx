import React, { useState } from 'react';
import type { DomainDef } from '../domains';
import { Modal, inputClass, labelClass } from './ui';

export interface SetupDomainValues {
  agentName: string;
  purpose: string;
  cap: number;
  category: string;
}

interface SetupDomainDialogProps {
  domain: DomainDef;
  /** Existing agent names (case-insensitive) to warn on duplicates. */
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (values: SetupDomainValues) => void;
}

/**
 * Explicit setup for a new domain agent + standing rule.
 * Creating authority always requires the user's explicit confirmation —
 * this dialog is that confirmation. It only collects the agent half;
 * the rule half is completed in the normal rule-creation form afterwards,
 * so every value stays user-visible and nothing is silently granted.
 */
export const SetupDomainDialog: React.FC<SetupDomainDialogProps> = ({ domain, existingNames, onCancel, onConfirm }) => {
  const [agentName, setAgentName] = useState(domain.suggestedAgentName);
  const [purpose, setPurpose] = useState(domain.suggestedPurpose);
  const [cap, setCap] = useState(String(domain.suggestedCap));
  const [category, setCategory] = useState(domain.categories[0]);
  const [error, setError] = useState<string | null>(null);
  const nameTaken = existingNames.some((n) => n.toLowerCase() === agentName.trim().toLowerCase());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agentName.trim()) {
      setError('Give the agent a name.');
      return;
    }
    const capNum = parseFloat(cap);
    if (!capNum || capNum <= 0) {
      setError('Enter a spending limit greater than zero.');
      return;
    }
    if (!category) {
      setError('Choose what the rule covers.');
      return;
    }
    onConfirm({ agentName: agentName.trim(), purpose: purpose.trim() || domain.suggestedPurpose, cap: capNum, category });
  };

  return (
    <Modal onClose={onCancel}>
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">
        {domain.icon} Set up {domain.label}
      </h3>
      <p className="text-[13px] text-[#5a5c63] mt-1">
        This creates a long-lived <span className="font-medium text-[#0b1c30]">{domain.agentLabel.toLowerCase()}</span> that
        handles your {domain.label.toLowerCase()} requests. You&apos;ll confirm its spending rule on the next step —
        nothing can be spent until then.
      </p>
      {nameTaken && (
        <p className="mt-3 text-[13px] text-[#7a4a00] bg-[#fff6e0] border border-[#c49000]/30 rounded-lg px-3 py-2">
          An agent with a similar name already exists. Pick a distinct name to avoid confusion.
        </p>
      )}
      {error && <p className="mt-3 text-[13px] text-[#93000a] bg-[#fdf3f2] border border-[#e8c4c0] rounded-lg px-3 py-2">{error}</p>}
      <form onSubmit={submit} className="space-y-3.5 mt-4">
        <div>
          <label className={labelClass()}>Agent name</label>
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} className={`${inputClass()} mt-1`} />
        </div>
        <div>
          <label className={labelClass()}>What is it for?</label>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={`${inputClass()} mt-1`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass()}>Limit (₹ per {domain.unitWord})</label>
            <input type="number" min="1" step="any" value={cap} onChange={(e) => setCap(e.target.value)} className={`${inputClass()} mt-1`} />
          </div>
          <div>
            <label className={labelClass()}>Rule covers</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputClass()} mt-1 cursor-pointer`}>
              {domain.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[12px] text-[#76777d]">
          The rule will only cover <span className="font-medium text-[#0b1c30]">{category}</span> spending —
          anything else still needs review. You can confirm or change everything on the next step.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#0b1c30] text-white hover:opacity-90 cursor-pointer">
            Create agent &amp; set rule →
          </button>
        </div>
      </form>
    </Modal>
  );
};
