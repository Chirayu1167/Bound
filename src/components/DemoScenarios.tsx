import React, { useState } from 'react';
import type { AgentNode } from '../types';
import { ConfirmDialog } from './ui';

interface DemoScenariosProps {
  /** Fill the Ask bar with the scenario's request text. */
  onFillAsk: (text: string) => void;
  /** Resolved Food agent (null when not set up). Used by Scenario 4. */
  foodAgent: AgentNode | null;
  /** Toggle revoke/restore via the real API. */
  onRevokeAgent: (agentId: string) => Promise<void>;
}

interface ScenarioDef {
  n: string;
  title: string;
  ask: string;
  fields: string[];
  expected: string[];
}

/**
 * Deterministic guided demo scenarios. Buttons only fill the Ask bar or
 * call the real revoke/restore API — every outcome below is produced live
 * by the backend authorization + risk engine, never fabricated.
 *
 * Exact TaskCard values are listed because the engine matches on shared
 * wording (e.g. purpose "Groceries" under the Groceries rule).
 */
const SCENARIOS: ScenarioDef[] = [
  {
    n: '1',
    title: 'Safe dinner',
    ask: 'Order dinner under ₹800',
    fields: ['Purpose: Groceries', 'Max: ₹800', 'Merchant: Swiggy'],
    expected: ['Approved', 'Low risk', 'Payment', 'Completed'],
  },
  {
    n: '2',
    title: 'Risk review',
    ask: 'Try the Lucky Mart promo under ₹900',
    fields: ['Purpose: Urgent grocery profit prize deal', 'Max: ₹900', 'Merchant: Lucky Mart'],
    expected: ['Needs Review (Medium risk)', 'Approve Once', 'Payment', 'Completed'],
  },
  {
    n: '3',
    title: 'Wrong category',
    ask: 'Buy headphones under ₹500',
    fields: ['Pick the Food domain', 'Purpose: Electronics', 'Max: ₹500', 'Merchant: QuickElectro Ltd'],
    expected: ['Needs Review (category mismatch)', 'No direct payment'],
  },
];

export const DemoScenarios: React.FC<DemoScenariosProps> = ({ onFillAsk, foodAgent, onRevokeAgent }) => {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const foodRevoked = foodAgent?.status === 'REVOKED';

  const handleRevokeToggle = async () => {
    if (!foodAgent) return;
    setBusy(true);
    try {
      await onRevokeAgent(foodAgent.id);
    } finally {
      setBusy(false);
      setConfirmRevoke(false);
    }
  };

  return (
    <div>
      <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide">Demo scenarios</h2>
      <p className="text-[12px] text-[#76777d] mt-1">
        Guided tours of the real engine. Each button fills the request box — you run every check and payment yourself, nothing is staged.
      </p>
      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SCENARIOS.map((s) => (
          <div key={s.n} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[14px] font-semibold text-[#0b1c30]">
                <span className="text-[#76777d] font-normal">{s.n}. </span>
                {s.title}
              </p>
              <button
                onClick={() => onFillAsk(s.ask)}
                className="px-3 py-1.5 rounded-lg bg-[#0b1c30] text-white text-[12px] font-medium hover:opacity-90 cursor-pointer shrink-0"
              >
                Try it →
              </button>
            </div>
            <p className="text-[12px] text-[#5a5c63] mt-1.5 break-words">Ask: “{s.ask}”</p>
            <ul className="mt-1.5 space-y-0.5">
              {s.fields.map((f) => (
                <li key={f} className="text-[12px] text-[#5a5c63] break-words">
                  • {f}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-[#0a6b4a] mt-2 break-words">
              <span className="font-medium">Expected: </span>
              {s.expected.join(' → ')}
            </p>
          </div>
        ))}

        {/* Scenario 4 — revoked agent (mutates real state, restores itself) */}
        <div className="rounded-xl bg-white border border-[#e2e3e8] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] font-semibold text-[#0b1c30]">
              <span className="text-[#76777d] font-normal">4. </span>
              Revoked agent
            </p>
            {!foodAgent ? (
              <span className="text-[12px] text-[#76777d] shrink-0">Set up Food first</span>
            ) : foodRevoked ? (
              <button
                onClick={handleRevokeToggle}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-[#e6f4ee] text-[#0a6b4a] text-[12px] font-medium hover:bg-[#d4ecdf] cursor-pointer disabled:opacity-60 shrink-0"
              >
                {busy ? 'Working…' : 'Restore agent'}
              </button>
            ) : (
              <button
                onClick={() => setConfirmRevoke(true)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-[#fdecea] text-[#93000a] text-[12px] font-medium hover:bg-[#fbd9d5] cursor-pointer disabled:opacity-60 shrink-0"
              >
                Revoke Food agent
              </button>
            )}
          </div>
          <p className="text-[12px] text-[#5a5c63] mt-1.5 break-words">
            {foodAgent
              ? `Food agent is currently ${foodRevoked ? 'revoked' : 'active'}. Revoke it, run any check, then restore it — all through the real API.`
              : 'Needs an active Food agent with a rule.'}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            <li className="text-[12px] text-[#5a5c63]">• While revoked, checks return Needs Review with no approval and no payment</li>
          </ul>
          <p className="text-[12px] text-[#0a6b4a] mt-2">
            <span className="font-medium">Expected: </span>
            Needs Review (revoked authority) → no payment → restore → normal again
          </p>
        </div>
      </div>

      {confirmRevoke && foodAgent && (
        <ConfirmDialog
          title="Revoke the Food agent for the demo?"
          body="This uses the real revocation mechanism: new payments will need review with no approval path until you restore it. Nothing is deleted; restore reverses it."
          confirmLabel="Revoke agent"
          danger
          busy={busy}
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={handleRevokeToggle}
        />
      )}

      {/* Context awareness — proposals from your real history. Nothing here
          authorizes anything; every path still needs your confirmation and
          the Bound check. */}
      <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide mt-5">
        Context demos
      </h2>
      <p className="text-[12px] text-[#76777d] mt-1">
        Bound reads your recent payments to suggest amounts — your rule still caps every check.
      </p>
      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-white border border-[#e2e3e8] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] font-semibold text-[#0b1c30]">
              <span className="text-[#76777d] font-normal">A. </span>
              Usual dinner
            </p>
            <button
              onClick={() => onFillAsk('Order my usual dinner')}
              className="px-3 py-1.5 rounded-lg bg-[#0b1c30] text-white text-[12px] font-medium hover:opacity-90 cursor-pointer shrink-0"
            >
              Try it →
            </button>
          </div>
          <p className="text-[12px] text-[#5a5c63] mt-1.5 break-words">Ask: “Order my usual dinner” (no amount needed)</p>
          <p className="text-[12px] text-[#0a6b4a] mt-2 break-words">
            <span className="font-medium">Expected: </span>
            proposes your usual range from real history → you confirm → check → payment
          </p>
        </div>

        <div className="rounded-xl bg-white border border-[#e2e3e8] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] font-semibold text-[#0b1c30]">
              <span className="text-[#76777d] font-normal">B. </span>
              Same as last time
            </p>
            <button
              onClick={() => onFillAsk('Order the same thing as last time')}
              className="px-3 py-1.5 rounded-lg bg-[#0b1c30] text-white text-[12px] font-medium hover:opacity-90 cursor-pointer shrink-0"
            >
              Try it →
            </button>
          </div>
          <p className="text-[12px] text-[#5a5c63] mt-1.5 break-words">Ask: “Order the same thing as last time” (pick Food if asked)</p>
          <p className="text-[12px] text-[#0a6b4a] mt-2 break-words">
            <span className="font-medium">Expected: </span>
            shows last merchant + amount → you confirm → check → payment. Never repeats silently.
          </p>
        </div>

        <div className="rounded-xl bg-white border border-[#e2e3e8] p-4 sm:col-span-2">
          <p className="text-[14px] font-semibold text-[#0b1c30]">
            <span className="text-[#76777d] font-normal">C. </span>
            History can&apos;t raise your limit
          </p>
          <p className="text-[12px] text-[#5a5c63] mt-1.5 break-words">
            Ask “Order my usual dinner” after your usual grows past your rule — or lower the Food rule below
            your usual in Rules → Edit (reversible) and ask again. Bound proposes the capped amount and shows
            the conflict instead of approving the usual.
          </p>
          <p className="text-[12px] text-[#0a6b4a] mt-2 break-words">
            <span className="font-medium">Expected: </span>
            “Your usual is around ₹X, but your rule allows ₹Y” → Use ₹Y → check enforces the rule
          </p>
        </div>
      </div>
    </div>
  );
};
