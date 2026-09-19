import React from 'react';
import type { TransactionRecord } from '../types';
import { TechnicalDetails } from './ui';

interface ApprovalCardProps {
  tx: TransactionRecord;
  /** e.g. "Food Agent". Falls back to the recorded agent name. */
  agentDisplay: string;
  /** Factual rule line, e.g. "Your Food rule allows ₹2,000 per order". Null when no standing rule applies. */
  ruleLine: string | null;
  /** Derived from REAL history, e.g. "Your usual food spend is ₹300–₹600". Null when unknown. */
  usualLine: string | null;
  onReview: (tx: TransactionRecord) => void;
}

/**
 * Needs Review card for direct (non-task) checks — plain user language.
 *
 * These records have no task and therefore no approval entity: the only
 * honest actions are reviewing the evidence or managing the agent/rule.
 * One-time Approve/Deny live on task-based flows (Home), backed by the
 * real backend approval mechanism. No dead buttons are rendered here.
 */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({ tx, agentDisplay, ruleLine, usualLine, onReview }) => {
  const factors = (tx.risk_factors || []).slice(0, 3).map((f) => f.message).filter(Boolean);
  return (
    <div className="rounded-xl bg-white border border-[#e8c4c0] p-4">
      <p className="text-[14px] text-[#0b1c30] break-words">
        <span className="font-semibold">{agentDisplay}</span> wants to spend{' '}
        <span className="font-semibold">{tx.amount}</span>
      </p>
      <p className="text-[12px] text-[#5a5c63] mt-0.5 break-words">
        {tx.merchant} · {tx.merchant_category}
      </p>
      {ruleLine && <p className="text-[13px] text-[#0b1c30] mt-2">{ruleLine}</p>}
      {usualLine && <p className="text-[13px] text-[#5a5c63] mt-0.5">{usualLine}</p>}

      <div className="mt-2.5 rounded-lg bg-[#fdf3f2] border border-[#e8c4c0] px-3 py-2">
        <p className="text-[12px] font-medium text-[#93000a]">Why we&apos;re asking</p>
        <p className="text-[13px] text-[#0b1c30] mt-0.5 break-words">{tx.reason || 'This payment was outside the allowed rule.'}</p>
        {factors.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {factors.map((f, i) => (
              <li key={i} className="text-[12px] text-[#45464d] break-words">
                • {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onReview(tx)}
          className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer"
        >
          Review
        </button>
      </div>

      <div className="mt-2">
        <TechnicalDetails summary="About one-time approval">
          <p className="text-[12px] text-[#45464d]">
            This check wasn&apos;t made through a task, so there&apos;s no approval attached to it.
            Run requests from Home to get one-time Approve / Deny backed by the backend —
            approving never changes your standing rule. You can also revoke the agent or rule
            from Agents / Rules.
          </p>
        </TechnicalDetails>
      </div>
    </div>
  );
};
