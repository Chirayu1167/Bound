import React, { useEffect } from 'react';

/** User-facing decision labels. Backend stays ALLOW/VERIFY; UI shows Approved/Needs Review. */
export function decisionLabel(d: string): string {
  return d === 'ALLOW' ? 'Approved' : 'Needs Review';
}

export function DecisionBadge({ decision }: { decision: string }) {
  const approved = decision === 'ALLOW';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium border ${
        approved
          ? 'bg-[#e6f4ee] text-[#0a6b4a] border-[#0a6b4a]/20'
          : 'bg-[#fdecea] text-[#93000a] border-[#ba1a1a]/25'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${approved ? 'bg-[#0a6b4a]' : 'bg-[#ba1a1a]'}`} />
      {decisionLabel(decision)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  const expired = status === 'EXPIRED';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium border ${
        active
          ? 'bg-[#e6f4ee] text-[#0a6b4a] border-[#0a6b4a]/20'
          : expired
            ? 'bg-[#f2f2f4] text-[#45464d] border-[#c6c6cd]/50'
            : 'bg-[#fdecea] text-[#93000a] border-[#ba1a1a]/25'
      }`}
    >
      {status === 'ACTIVE' ? 'Active' : status === 'EXPIRED' ? 'Expired' : 'Revoked'}
    </span>
  );
}

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level) return <span className="text-[12px] text-[#76777d]">No risk score</span>;
  const l = level.toUpperCase();
  const style =
    l === 'HIGH'
      ? 'bg-[#fdecea] text-[#93000a] border-[#ba1a1a]/25'
      : l === 'MEDIUM'
        ? 'bg-[#fff6e0] text-[#7a4a00] border-[#c49000]/30'
        : 'bg-[#eef3ff] text-[#33467c] border-[#c6c6cd]/50';
  const hint = l === 'HIGH' ? 'several strong risk signals' : l === 'MEDIUM' ? 'some unusual behaviour' : 'no unusual behaviour';
  return (
    <span title={hint} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium border ${style}`}>
      {l === 'HIGH' ? 'High risk' : l === 'MEDIUM' ? 'Medium risk' : 'Low risk'}
    </span>
  );
}

export function riskExplanation(level?: string | null): string {
  const l = (level || '').toUpperCase();
  if (l === 'HIGH') return 'High — several strong risk signals detected';
  if (l === 'MEDIUM') return 'Medium — some unusual behaviour detected';
  return 'Low — no unusual behaviour detected';
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="py-10 px-6 text-center border border-dashed border-[#c6c6cd] rounded-xl bg-white">
      <p className="text-[14px] font-medium text-[#0b1c30]">{title}</p>
      {body && <p className="text-[13px] text-[#5a5c63] mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function TechnicalDetails({ summary = 'Technical details', children }: { summary?: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-[#e2e3e8] bg-[#fafbff] px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-medium text-[#45464d] hover:text-[#0b1c30]">{summary}</summary>
      <div className="mt-2 space-y-1.5">{children}</div>
    </details>
  );
}

export function TechRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[12px]">
      <span className="text-[#76777d] shrink-0">{k}</span>
      <span className="text-[#0b1c30] font-mono break-all text-right">{v}</span>
    </div>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-semibold text-[#0b1c30] tracking-tight">{title}</h2>
        {sub && <p className="text-[13px] text-[#5a5c63] mt-0.5">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Base modal: closes on Escape and backdrop click. */
export function Modal({ onClose, children, maxWidth = 'max-w-lg' }: { onClose: () => void; children: React.ReactNode; maxWidth?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/50 p-4" onClick={onClose}>
      <div className={`w-full ${maxWidth} rounded-xl bg-white shadow-xl border border-[#e2e3e8] p-6`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onCancel} maxWidth="max-w-md">
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">{title}</h3>
      <p className="text-[13px] text-[#45464d] mt-2 leading-relaxed">{body}</p>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-[13px] font-medium text-white cursor-pointer disabled:opacity-60 ${danger ? 'bg-[#ba1a1a] hover:bg-[#93000a]' : 'bg-[#0b1c30] hover:opacity-90'}`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function inputClass(): string {
  return 'w-full px-3 py-2 bg-white rounded-lg text-[13px] text-[#0b1c30] outline-none border border-[#c6c6cd] focus:border-[#0051d5] placeholder:text-[#9a9ba1]';
}

export function labelClass(): string {
  return 'text-[12px] text-[#0b1c30] font-medium';
}

export function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60 ${rest.className || ''}`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`px-3.5 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60 ${rest.className || ''}`}>
      {children}
    </button>
  );
}
