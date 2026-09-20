/**
 * Bound — "Why did my agent do this?" panel.
 *
 * Structured authorization reasoning only: every row is derived from real
 * backend fields (agent status, mandate cap/category, requested values).
 * No chain-of-thought, no invented checks.
 */

import React from 'react';
import { purposeOverlapsRule } from '../domains';

interface WhyPanelProps {
  agentName: string;
  agentActive: boolean;
  /** Standing-rule cap in INR, null when the agent has no rule. */
  cap: number | null;
  ruleCategory: string | null;
  rulePurpose: string | null;
  requestedAmount: number;
  merchant: string;
  category: string;
  purpose: string;
  approved: boolean;
  reason: string | null;
}

function Row({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span
        className={`w-[18px] h-[18px] rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 mt-px ${
          ok === null ? 'bg-[#eef1f6] text-[#76777d]' : ok ? 'bg-[#e6f4ee] text-[#0a6b4a]' : 'bg-[#fdecea] text-[#93000a]'
        }`}
      >
        {ok === null ? '·' : ok ? '✓' : '✗'}
      </span>
      <span className="min-w-0">
        <span className="font-medium text-[#0b1c30]">{label}</span>
        <span className="text-[#5a5c63]"> — {detail}</span>
      </span>
    </li>
  );
}

export const WhyPanel: React.FC<WhyPanelProps> = ({
  agentName,
  agentActive,
  cap,
  ruleCategory,
  rulePurpose,
  requestedAmount,
  merchant,
  category,
  purpose,
  approved,
  reason,
}) => {
  const hasRule = cap !== null;
  const withinBudget = hasRule ? requestedAmount <= (cap as number) : null;
  const categoryOk = ruleCategory ? category.toLowerCase() === ruleCategory.toLowerCase() : null;
  const wordingOk =
    rulePurpose && purpose ? purposeOverlapsRule(rulePurpose, ruleCategory || '', purpose) : null;

  return (
    <div className="rounded-lg border border-[#e2e3e8] bg-white px-3.5 py-3">
      <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">
        Why did {agentName} do this?
      </p>
      <ul className="mt-2 space-y-1.5">
        <Row ok={agentActive} label="Agent active" detail={agentActive ? `${agentName} is active` : `${agentName} is revoked`} />
        <Row
          ok={hasRule}
          label="User authorization"
          detail={hasRule ? `₹${(cap as number).toLocaleString()} per order` : 'No standing rule for this agent'}
        />
        <Row
          ok={withinBudget}
          label="Within budget"
          detail={`Requested ₹${requestedAmount.toLocaleString()}${hasRule ? ` of ₹${(cap as number).toLocaleString()}` : ''} at ${merchant}`}
        />
        <Row
          ok={categoryOk}
          label="Category allowed"
          detail={ruleCategory ? `${category} vs rule ${ruleCategory}` : 'No rule category to compare'}
        />
        {wordingOk !== null && (
          <Row
            ok={wordingOk}
            label="Purpose matches rule"
            detail={`“${purpose}”${wordingOk ? '' : ` doesn't match rule wording “${rulePurpose}”`}`}
          />
        )}
      </ul>
      <div className={`mt-2.5 rounded-lg px-3 py-2 text-[13px] ${approved ? 'bg-[#e6f4ee] text-[#0a6b4a]' : 'bg-[#fdecea] text-[#93000a]'}`}>
        <span className="font-semibold">Decision: {approved ? 'APPROVED' : 'NEEDS REVIEW'}</span>
        {reason && <span className="block mt-0.5 text-[12px] opacity-90">{reason}</span>}
      </div>
    </div>
  );
};
