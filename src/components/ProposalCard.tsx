/**
 * Bound — Agent proposal card.
 *
 * The agent has already decided WHO (agent), WHERE (merchant) and HOW MUCH
 * (max + actual charge) from the request + history. The user sees one
 * screen, edits anything, and confirms once. Confirm runs the real
 * authorize → (if APPROVED) pay pipeline; anything needing review falls
 * back to the normal approval UI. The agent never spends without this tap.
 */

import React, { useState } from 'react';

export interface ProposalInput {
  merchant: string;
  max: number;
  charge: number;
  item: string | null;
}

export type ExecStage = 'checking' | 'paying';

interface ProposalCardProps {
  agentName: string;
  agentIcon: string;
  ruleLine: string | null;
  purpose: string;
  notes: string[];
  initialMerchant: string | null;
  initialMax: number | null;
  walletBalance: number | null;
  busy: boolean;
  stage: ExecStage | null;
  error: string | null;
  onConfirm: (input: ProposalInput) => void;
  onEdit: () => void;
  onDismiss: () => void;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({
  agentName,
  agentIcon,
  ruleLine,
  purpose,
  notes,
  initialMerchant,
  initialMax,
  walletBalance,
  busy,
  stage,
  error,
  onConfirm,
  onEdit,
  onDismiss,
}) => {
  const [merchant, setMerchant] = useState(initialMerchant || '');
  const [maxText, setMaxText] = useState(initialMax != null ? String(initialMax) : '');
  const [chargeText, setChargeText] = useState(initialMax != null ? String(initialMax) : '');
  const [item, setItem] = useState('');

  const max = parseFloat(maxText);
  const charge = parseFloat(chargeText);
  const maxValid = Number.isFinite(max) && max > 0;
  const chargeValid = Number.isFinite(charge) && charge > 0;
  const overCeiling = maxValid && chargeValid && charge > max;
  const after = walletBalance != null && chargeValid ? walletBalance - charge : null;
  const canConfirm = !busy && merchant.trim() !== '' && maxValid && chargeValid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm({
      merchant: merchant.trim(),
      max: Math.round(max * 100) / 100,
      charge: Math.round(charge * 100) / 100,
      item: item.trim() || null,
    });
  };

  return (
    <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-[#0b1c30] text-white flex items-center justify-center text-[18px] shrink-0">
            {agentIcon}
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[#0b1c30] truncate">
              {agentName} is on it
            </h2>
            <p className="text-[12px] text-[#76777d] truncate">
              {purpose}
              {ruleLine ? ` · ${ruleLine}` : ''}
            </p>
          </div>
        </div>
        <button onClick={onDismiss} disabled={busy} className="text-[12px] text-[#76777d] hover:text-[#0b1c30] cursor-pointer shrink-0 disabled:opacity-60">
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

      <form onSubmit={submit} className="mt-3 space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Where from?</label>
            <input
              value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={busy}
              placeholder="e.g. Swiggy"
              className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1] disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">What&apos;s the order? (optional)</label>
            <input
              value={item} onChange={(e) => setItem(e.target.value)} disabled={busy} maxLength={200}
              placeholder="e.g. Margherita Pizza"
              className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1] disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Up to (₹)</label>
            <input
              type="number" min="1" step="any" value={maxText} onChange={(e) => { setMaxText(e.target.value); }} disabled={busy}
              className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Charge (₹)</label>
            <input
              type="number" min="1" step="any" value={chargeText} onChange={(e) => setChargeText(e.target.value)} disabled={busy}
              className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] disabled:opacity-60"
            />
          </div>
        </div>

        {overCeiling && (
          <p className="text-[12px] text-[#93000a] bg-[#fdecea] border border-[#e8c4c0] rounded-lg px-3 py-2">
            Charge is above the authorization — the backend will refuse it. Lower the charge or raise the max.
          </p>
        )}

        {walletBalance != null && chargeValid && (
          <p className="text-[13px] text-[#0b1c30] rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2">
            Wallet ₹{walletBalance.toLocaleString()} → <span className="font-semibold">₹{(after as number).toLocaleString()}</span>
          </p>
        )}

        {error && <p className="text-[13px] text-[#93000a]">{error}</p>}

        {stage && (
          <div className="rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2.5 space-y-1">
            <p className={`text-[13px] ${stage === 'checking' ? 'text-[#0b1c30] font-medium' : 'text-[#0a6b4a]'}`}>
              {stage === 'checking' ? '●' : '✓'} {agentName} checked authority with Bound
            </p>
            {stage === 'paying' && (
              <p className="text-[13px] text-[#0b1c30] font-medium">● Paying from your demo wallet…</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={!canConfirm}
            className="flex-1 min-w-40 px-4 py-2.5 rounded-lg bg-[#0b1c30] text-white text-[14px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
          >
            {busy ? (stage === 'paying' ? 'Paying…' : 'Checking…') : `Confirm & Pay ₹${chargeValid ? charge.toLocaleString() : '…'}`}
          </button>
          <button
            type="button" onClick={onEdit} disabled={busy}
            className="px-4 py-2.5 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60"
          >
            Edit details
          </button>
        </div>
        <p className="text-[11px] text-[#76777d]">Nothing moves until you confirm. Needs-review requests fall back to approval.</p>
      </form>
    </div>
  );
};
