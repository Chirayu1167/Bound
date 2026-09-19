import React, { useRef, useState } from 'react';
import { DOMAINS, purposeOverlapsRule, ruleSummary, scopeLine, type DomainId } from '../domains';
import type { AgentNode, MandateItem } from '../types';
import type { TaskDraft } from '../tasks';

export interface TaskCheckInput {
  draft: TaskDraft;
  merchant: string;
  purpose: string;
  budget: number;
}

interface TaskCardProps {
  draft: TaskDraft;
  agent: AgentNode | null;
  mandate: MandateItem | null;
  domainId: DomainId;
  /** Real merchants from history — suggestions only, never auto-filled. */
  merchantSuggestions: string[];
  checking: boolean;
  checkError: string | null;
  onSelectDomain: (domainId: DomainId) => void;
  onSetupDomain: (domainId: DomainId) => void;
  onCheck: (input: TaskCheckInput) => void;
  onDismiss: () => void;
  notes: string[];
  /** Merchant suggested from context/history. Applied once, stays editable. */
  initialMerchant?: string | null;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  draft,
  agent,
  mandate,
  domainId,
  merchantSuggestions,
  checking,
  checkError,
  onSelectDomain,
  onSetupDomain,
  onCheck,
  onDismiss,
  notes,
  initialMerchant,
}) => {
  const [pickedDomain, setPickedDomain] = useState<DomainId>(domainId);
  const [purpose, setPurpose] = useState(draft.purpose);
  const [budget, setBudget] = useState(draft.budget !== null ? String(draft.budget) : '');
  const [merchant, setMerchant] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // Context-suggested merchant: applied once per suggestion, never overwrites typing.
  const appliedMerchant = useRef<string | null>(null);
  React.useEffect(() => {
    if (initialMerchant && initialMerchant !== appliedMerchant.current) {
      setMerchant(initialMerchant);
      appliedMerchant.current = initialMerchant;
    }
  }, [initialMerchant]);

  const domain = DOMAINS.find((d) => d.id === pickedDomain) || DOMAINS[0];
  const resolved = agent && mandate;
  const wordingOk = !mandate || !purpose.trim() || purposeOverlapsRule(mandate.purpose, mandate.merchant_category, purpose);

  const pick = (id: DomainId) => {
    setPickedDomain(id);
    onSelectDomain(id);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = parseFloat(budget);
    if (!purpose.trim()) {
      setFormError('Describe what this is for.');
      return;
    }
    if (!amt || amt <= 0) {
      setFormError('Enter a maximum amount greater than zero.');
      return;
    }
    if (!merchant.trim()) {
      setFormError('Say where this should be spent — Bound checks the real place, never an invented one.');
      return;
    }
    onCheck({ draft, merchant: merchant.trim(), purpose: purpose.trim(), budget: amt });
  };

  return (
    <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[#0b1c30]">Here&apos;s what I understood</h2>
        <button onClick={onDismiss} className="text-[12px] text-[#76777d] hover:text-[#0b1c30] cursor-pointer shrink-0">
          Dismiss
        </button>
      </div>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {notes.map((n, i) => (
            <li key={i} className="text-[12px] text-[#5a5c63]">
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <p className="text-[12px] text-[#76777d] mb-1.5">Handling this with:</p>
        <div className="flex gap-1.5 flex-wrap">
          {DOMAINS.map((d) => (
            <button
              key={d.id}
              onClick={() => pick(d.id)}
              className={`px-3 py-1.5 rounded-lg text-[13px] cursor-pointer border ${
                pickedDomain === d.id
                  ? 'bg-[#0b1c30] text-white border-[#0b1c30] font-medium'
                  : 'bg-white text-[#0b1c30] border-[#e2e3e8] hover:border-[#9a9ba1]'
              }`}
            >
              {d.icon} {d.label}
            </button>
          ))}
        </div>
      </div>

      {resolved ? (
        <form onSubmit={submit} className="mt-4 pt-3 border-t border-[#eef0f4] space-y-3">
          <p className="text-[13px] text-[#0b1c30]">
            <span className="font-medium">{agent.name}</span>
            <span className="text-[#5a5c63]">
              {' '}· {domain.agentLabel} rule: {ruleSummary(mandate, domain)} · {scopeLine(domain, mandate.merchant_category)}
            </span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">For what?</label>
              <input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Maximum (₹)</label>
              <input
                type="number"
                min="1"
                step="any"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Where from?</label>
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="e.g. Swiggy"
                list="task-merchant-suggestions"
                className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1]"
              />
              <datalist id="task-merchant-suggestions">
                {merchantSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          {!wordingOk && (
            <p className="text-[12px] text-[#7a4a00] bg-[#fff6e0] border border-[#c49000]/30 rounded-lg px-3 py-2">
              Heads up: your {domain.label} rule covers “{mandate.purpose}” — “{purpose.trim() || 'this wording'}” is
              worded differently, so the check will likely need review. The rule matches on shared wording.
            </p>
          )}

          {(formError || checkError) && (
            <p className="text-[13px] text-[#93000a]">{formError || checkError}</p>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12px] text-[#76777d]">Nothing is authorized yet. Bound&apos;s check decides Approved or Needs Review.</p>
            <button
              type="submit"
              disabled={checking}
              className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60 shrink-0"
            >
              {checking ? 'Checking…' : 'Check with Bound →'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 pt-3 border-t border-[#eef0f4] flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] text-[#5a5c63]">
            No active {domain.agentLabel.toLowerCase()} rule yet — Bound can&apos;t check this until you set one up.
          </p>
          <button
            onClick={() => onSetupDomain(pickedDomain)}
            className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer shrink-0"
          >
            Set up {domain.label} rule
          </button>
        </div>
      )}
    </div>
  );
};
