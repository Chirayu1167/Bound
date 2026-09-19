import React from 'react';
import type { ApprovalItem, TaskItem } from '../types';
import { RiskBadge, TechnicalDetails, riskExplanation } from './ui';

interface TaskResultCardProps {
  task: TaskItem;
  /** Pending approval for this task, if any. */
  approval: ApprovalItem | null;
  agentName: string;
  domainLabel: string;
  ruleLine: string | null;
  usualLine: string | null;
  /** Top real risk-factor messages (max 3), from the linked transaction. */
  riskFactors: string[];
  busy: boolean;
  actionError: string | null;
  onApprove: (approval: ApprovalItem) => void;
  onDeny: (approval: ApprovalItem) => void;
  onCancelTask: (task: TaskItem) => void;
  onDismiss?: () => void;
  /** When provided, APPROVED tasks show a Continue-to-payment button. */
  onPay?: (task: TaskItem) => void;
}

/**
 * Outcome of POST /tasks/authorize, in user language.
 *
 * Approved: a receipt for the AUTHORIZATION — explicitly not an order or a
 * payment, because Bound does not execute merchants.
 *
 * Needs Review: the real approval with working one-time Approve/Deny.
 * Approving authorizes only this task; the standing rule is never touched.
 */
export const TaskResultCard: React.FC<TaskResultCardProps> = ({
  task,
  approval,
  agentName,
  domainLabel,
  ruleLine,
  usualLine,
  riskFactors,
  busy,
  actionError,
  onApprove,
  onDeny,
  onCancelTask,
  onDismiss,
  onPay,
}) => {
  const approved = task.status === 'APPROVED';
  const authOk = task.authorization_status === 'ALLOW';

  return (
    <div className={`rounded-xl bg-white border p-5 ${approved ? 'border-[#0a6b4a]/30' : 'border-[#e8c4c0]'}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={`text-[15px] font-semibold min-w-0 break-words ${approved ? 'text-[#0a6b4a]' : 'text-[#0b1c30]'}`}>
          {approved ? 'Approved' : `${agentName} wants to spend ₹${task.requested_amount.toLocaleString()}`}
        </h2>
        {onDismiss && (
          <button onClick={onDismiss} className="text-[12px] text-[#76777d] hover:text-[#0b1c30] cursor-pointer shrink-0">
            Dismiss
          </button>
        )}
      </div>

      {approved ? (
        <div className="mt-3 rounded-lg bg-[#f4faf7] border border-[#0a6b4a]/25 px-4 py-3">
          <p className="text-[12px] font-medium text-[#0a6b4a] uppercase tracking-wide">Bound check</p>
          <dl className="mt-1.5 space-y-1 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#5a5c63]">Decision</dt>
              <dd className="font-semibold text-[#0a6b4a]">Approved</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#5a5c63]">Authority</dt>
              <dd className="font-medium text-[#0b1c30]">Approved ✓</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#5a5c63]">Task limit</dt>
              <dd className="font-medium text-[#0b1c30]">₹{task.requested_amount.toLocaleString()}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#5a5c63]">Risk</dt>
              <dd className="font-medium text-[#0b1c30]">
                {task.risk_level === 'HIGH' ? 'High' : task.risk_level === 'MEDIUM' ? 'Medium' : 'Low'} risk
                {task.risk_score !== null ? ` (${task.risk_score}/100)` : ''}
              </dd>
            </div>
          </dl>
          <p className="text-[13px] text-[#0b1c30] mt-2 break-words">
            <span className="font-medium">{agentName}</span> may spend up to{' '}
            <span className="font-medium">₹{task.requested_amount.toLocaleString()}</span> on {task.purpose} at {task.merchant}.
          </p>
          {ruleLine && <p className="text-[12px] text-[#5a5c63] mt-1">{ruleLine}</p>}
          <p className="text-[12px] text-[#76777d] mt-1">
            This is an authorization, not an order — no payment was executed and nothing was bought.
          </p>
          {onPay && (
            <button
              onClick={() => onPay(task)}
              className="mt-3 px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer"
            >
              Continue to payment →
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">
          <p className="text-[12px] text-[#5a5c63] break-words">
            {task.merchant} · {task.category}
          </p>

          {/* Authorization — what the rule said */}
          <div className={`rounded-lg border px-3 py-2.5 ${authOk ? 'bg-[#f4faf7] border-[#0a6b4a]/25' : 'bg-[#fdf3f2] border-[#e8c4c0]'}`}>
            <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Authorization</p>
            {authOk ? (
              <p className="text-[13px] text-[#0b1c30] mt-0.5">
                <span className="font-semibold text-[#0a6b4a]">Approved</span>
                <span className="text-[#5a5c63]"> — authority is fine, but risk needs a human decision.</span>
              </p>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-[#93000a] mt-0.5">Outside your rule</p>
                {ruleLine && <p className="text-[13px] text-[#0b1c30] mt-0.5">{ruleLine}</p>}
                {task.reason && <p className="text-[12px] text-[#5a5c63] mt-0.5 break-words">{task.reason}</p>}
              </>
            )}
          </div>

          {/* Risk — what the engine observed */}
          <div className="rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Risk</p>
              <RiskBadge level={task.risk_level} />
            </div>
            <p className="text-[12px] text-[#5a5c63] mt-1">{riskExplanation(task.risk_level)}</p>
            {usualLine && <p className="text-[12px] text-[#5a5c63] mt-0.5">{usualLine}</p>}
          </div>

          {/* Why — the most important real factors only */}
          {riskFactors.length > 0 && (
            <div className="rounded-lg bg-[#fdf3f2] border border-[#e8c4c0] px-3 py-2.5">
              <p className="text-[12px] font-medium text-[#93000a] uppercase tracking-wide">Why we&apos;re asking</p>
              <ul className="mt-1 space-y-1">
                {riskFactors.slice(0, 3).map((f, i) => (
                  <li key={i} className="text-[13px] text-[#0b1c30] break-words">
                    • {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {actionError && <p className="text-[13px] text-[#93000a]">{actionError}</p>}

          {approval && approval.status === 'PENDING' ? (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onApprove(approval)}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Approve once'}
              </button>
              <button
                onClick={() => onDeny(approval)}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60"
              >
                Deny
              </button>
              <button
                onClick={() => onCancelTask(task)}
                disabled={busy}
                className="text-[13px] text-[#76777d] hover:text-[#93000a] cursor-pointer disabled:opacity-60"
              >
                Cancel task
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-[#76777d]">
              {approval ? `Approval ${approval.status.toLowerCase()}.` : 'No approval is available for this task.'}
            </p>
          )}
          <p className="text-[12px] text-[#76777d]">
            Approving authorizes only this task — your rule stays exactly as it is.
          </p>
        </div>
      )}

      <div className="mt-2">
        <TechnicalDetails summary="How this was decided">
          <p className="text-[12px] text-[#45464d]">
            Task {task.id} · engine decision {task.decision || '—'}
            {task.authorization_status ? ` (authorization ${task.authorization_status}` : ''}
            {task.risk_level ? `, risk ${task.risk_level}${task.risk_score !== null ? ` ${task.risk_score}/100` : ''})` : task.authorization_status ? ')' : ''}.
            {domainLabel ? ` Domain ${domainLabel}.` : ''} Full evidence is under Activity.
          </p>
        </TechnicalDetails>
      </div>
    </div>
  );
};
