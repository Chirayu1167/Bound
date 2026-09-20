import React, { useState } from 'react';
import type { MockPaymentItem, TaskItem } from '../types';
import { TechnicalDetails, TechRow } from './ui';

interface PaymentScreenProps {
  task: TaskItem;
  agentName: string;
  riskLevel: string | null;
  riskScore: number | null;
  /** Plain-language risk reasons (top factors), empty when none. */
  riskFactors: string[];
  authReason: string | null;
  /** True when this task was approved via one-time approval. */
  approvedOnce: boolean;
  payment: MockPaymentItem | null;
  busy: boolean;
  error: string | null;
  onPay: (method: string, note: string) => void;
  onRetry: () => void;
  onNewRequest: () => void;
  onViewActivity: () => void;
  onBack: () => void;
  /** Re-attempts execution of the succeeded payment; resolves with the backend's rejection message (409). */
  onVerifyReplay?: () => Promise<string>;
}

function riskLabel(level: string | null): string {
  if (level === 'HIGH') return 'High';
  if (level === 'MEDIUM') return 'Medium';
  return 'Low';
}

/**
 * Iron-style simulated payment screen, adapted to Bound.
 *
 * Takes Iron's useful interaction ideas — amount-first review, explicit
 * security status, processing state, success receipt with ref + reset —
 * without its UPI/OTP/PIN machinery. The screen NEVER decides: Pay only
 * calls the backend, which gates on task APPROVED + fresh + agent ACTIVE.
 * There is no fake verification step; the approval (when needed) already
 * happened on the task.
 */
export const PaymentScreen: React.FC<PaymentScreenProps> = ({
  task,
  agentName,
  riskLevel,
  riskScore,
  riskFactors,
  authReason,
  approvedOnce,
  payment,
  busy,
  error,
  onPay,
  onRetry,
  onNewRequest,
  onViewActivity,
  onBack,
  onVerifyReplay,
}) => {
  const [method, setMethod] = useState('Demo Balance');
  const [note, setNote] = useState('');
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

  const verifyReplay = async () => {
    if (!onVerifyReplay || replayBusy) return;
    setReplayBusy(true);
    try {
      const msg = await onVerifyReplay();
      setReplayMsg(msg);
    } finally {
      setReplayBusy(false);
    }
  };

  const showProcessing = busy || payment?.status === 'PROCESSING' || payment?.status === 'CREATED';
  const succeeded = payment?.status === 'SUCCEEDED';
  const failed = payment?.status === 'FAILED';

  const microStage = succeeded || failed ? 3 : showProcessing ? 2 : 0;
  const microSteps = ['Details', 'Security', 'Pay', 'Receipt'];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || payment) return;
    onPay(method, note.trim());
  };

  return (
    <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[#0b1c30]">
          {succeeded ? 'Payment successful' : failed ? 'Payment failed' : `Pay ₹${task.requested_amount.toLocaleString()}`}
        </h2>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fff6e0] text-[#7a4a00] border border-[#c49000]/30 shrink-0">
          Demo payment · No real funds transferred
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1.5" aria-label="Payment progress">
        {microSteps.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${
                  i < microStage
                    ? 'bg-[#e6f4ee] text-[#0a6b4a]'
                    : i === microStage
                      ? 'bg-[#0b1c30] text-white'
                      : 'bg-[#eef1f6] text-[#9a9ba1]'
                }`}
              >
                {i < microStage ? '✓' : i + 1}
              </span>
              <span className={`text-[12px] hidden sm:inline ${i === microStage ? 'font-semibold text-[#0b1c30]' : 'text-[#76777d]'}`}>
                {label}
              </span>
            </div>
            {i < microSteps.length - 1 && <span className="flex-1 h-px bg-[#e2e3e8] min-w-2" />}
          </React.Fragment>
        ))}
      </div>

      {succeeded && payment ? (
        <div className="mt-4 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#e6f4ee] flex items-center justify-center">
            <span className="text-[#0a6b4a] text-[26px] font-semibold">✓</span>
          </div>
          <p className="text-[15px] font-semibold text-[#0b1c30] mt-3">
            ₹{payment.amount.toLocaleString()} sent to {payment.merchant} (demo)
          </p>
          <p className="text-[12px] text-[#76777d] mt-1 break-words">
            Ref: {payment.id} · Task {task.id} · {payment.payment_method}
            {payment.completed_at ? ` · ${new Date(payment.completed_at).toLocaleString()}` : ''}
          </p>
          {payment.note && <p className="text-[12px] text-[#5a5c63] mt-1">“{payment.note}”</p>}
          <p className="text-[12px] text-[#76777d] mt-2">Simulated payment — no real money moved.</p>
          <p className="text-[12px] text-[#0a6b4a] mt-1 font-medium">Approval token: consumed — it cannot be reused.</p>
          {onVerifyReplay && (
            <div className="mt-3 w-full rounded-lg border border-[#e2e3e8] bg-[#fafbff] px-3 py-2.5 text-left">
              {replayMsg ? (
                <p className="text-[12px] text-[#0b1c30]">✓ Replay blocked — {replayMsg}</p>
              ) : (
                <button onClick={verifyReplay} disabled={replayBusy} className="text-[12px] font-medium text-[#0051d5] hover:underline cursor-pointer disabled:opacity-60">
                  {replayBusy ? 'Checking…' : 'Verify replay protection'}
                </button>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2 w-full">
            <button onClick={onNewRequest} className="flex-1 px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer">
              New request
            </button>
            <button onClick={onViewActivity} className="flex-1 px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer">
              View in Activity
            </button>
          </div>
        </div>
      ) : failed && payment ? (
        <div className="mt-4">
          <div className="rounded-lg bg-[#fdf3f2] border border-[#e8c4c0] px-3 py-2.5">
            <p className="text-[13px] font-medium text-[#93000a]">Demo payment failed</p>
            <p className="text-[13px] text-[#0b1c30] mt-0.5">{payment.failure_reason || 'The simulated payment did not complete.'}</p>
            <p className="text-[12px] text-[#5a5c63] mt-1">Your task is still approved — retrying is safe and never double-pays.</p>
          </div>
          {error && <p className="mt-2 text-[13px] text-[#93000a]">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={onRetry} disabled={busy} className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60">
              {busy ? 'Retrying…' : 'Try again'}
            </button>
            <button onClick={onBack} disabled={busy} className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">
              Back to task
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3.5">
          <div className="rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-4 py-3">
            <p className="text-[26px] font-semibold text-[#0b1c30]">₹{task.requested_amount.toLocaleString()}</p>
            <p className="text-[13px] text-[#0b1c30] mt-0.5 break-words">
              {task.merchant} <span className="text-[#76777d]">· {task.category} · {task.purpose}</span>
            </p>
            <p className="text-[12px] text-[#76777d] mt-0.5">via {agentName}</p>
          </div>

          <div className="rounded-lg border border-[#0a6b4a]/25 bg-[#f4faf7] px-3.5 py-2.5 space-y-1">
            <p className="text-[12px] font-medium text-[#0a6b4a] uppercase tracking-wide">Security status</p>
            <p className="text-[13px] text-[#0b1c30]">Authority: Approved ✓</p>
            <p className="text-[13px] text-[#0b1c30]">
              Risk: {riskLabel(riskLevel)}{riskScore !== null ? ` (${riskScore}/100)` : ''}
            </p>
            {approvedOnce && <p className="text-[12px] text-[#5a5c63]">Approved once by you — this payment only.</p>}
            {authReason && <p className="text-[12px] text-[#5a5c63]">{authReason}</p>}
            {riskFactors.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {riskFactors.slice(0, 3).map((f, i) => (
                  <li key={i} className="text-[12px] text-[#5a5c63]">• {f}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Pay with</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy} className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] cursor-pointer bg-white disabled:opacity-60">
                <option value="Demo Balance">Demo Balance (no real methods in demo)</option>
              </select>
            </div>
            <div>
              <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. Friday dinner"
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1] disabled:opacity-60"
              />
            </div>
          </div>

          {error && <p className="text-[13px] text-[#93000a]">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-lg bg-[#0b1c30] text-white text-[14px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
            >
              {showProcessing ? 'Processing demo payment…' : `Pay ₹${task.requested_amount.toLocaleString()}`}
            </button>
            <button type="button" onClick={onBack} disabled={busy} className="px-4 py-2.5 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">
              Back
            </button>
          </div>
        </form>
      )}

      <div className="mt-3">
        <TechnicalDetails summary="Payment technical details">
          <TechRow k="Task ID" v={task.id} />
          <TechRow k="Transaction ID" v={task.transaction_id || '—'} />
          {payment && <TechRow k="Payment ID" v={payment.id} />}
          {payment && <TechRow k="Payment status" v={payment.status} />}
        </TechnicalDetails>
      </div>
    </div>
  );
};
