import React from 'react';
import { DOMAINS, type DomainDef, type DomainId } from '../domains';
import type { TransactionRecord } from '../types';
import type { UsualSpend } from '../preferences';
import { formatINR } from '../context';

export type ConversationState =
  | { kind: 'need-domain'; text: string }
  | { kind: 'proposal-usual'; domain: DomainDef; usual: UsualSpend; cap: number | null }
  | { kind: 'proposal-last'; domain: DomainDef; tx: TransactionRecord }
  | { kind: 'proposal-cheaper'; domain: DomainDef; amount: number; basis: string }
  | { kind: 'insufficient'; domain: DomainDef | null; what: string }
  | { kind: 'spending-answer'; domain: DomainDef | null; items: TransactionRecord[] };

interface ConversationCardProps {
  state: ConversationState;
  busy?: boolean;
  onPickDomain: (d: DomainId) => void;
  onAcceptBudget: (amount: number) => void;
  onAcceptLast: (tx: TransactionRecord) => void;
  onEnterManually: () => void;
  onDismiss: () => void;
}

function Shell({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">{children}</div>
        <button onClick={onDismiss} className="text-[12px] text-[#76777d] hover:text-[#0b1c30] cursor-pointer shrink-0">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function BoundLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-6 h-6 rounded-full bg-[#0b1c30] text-white text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
        B
      </span>
      <div className="text-[13px] text-[#0b1c30] leading-relaxed min-w-0">{children}</div>
    </div>
  );
}

/**
 * Lightweight conversation turn — NOT a chatbot. Renders exactly one
 * Bound clarification/proposal/answer at a time. Every financial path out
 * of here requires an explicit user confirmation, and the TaskCard check
 * that follows is a separate explicit click.
 */
export const ConversationCard: React.FC<ConversationCardProps> = ({
  state,
  busy,
  onPickDomain,
  onAcceptBudget,
  onAcceptLast,
  onEnterManually,
  onDismiss,
}) => {
  if (state.kind === 'need-domain') {
    return (
      <Shell onDismiss={onDismiss}>
        <BoundLine>
          <p>
            Same as usual for which area — <span className="font-medium">Food</span>,{' '}
            <span className="font-medium">Travel</span>, or <span className="font-medium">Shopping</span>?
          </p>
          <div className="flex gap-1.5 flex-wrap mt-2">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                onClick={() => onPickDomain(d.id)}
                className="px-3 py-1.5 rounded-lg text-[13px] cursor-pointer border bg-white text-[#0b1c30] border-[#e2e3e8] hover:border-[#9a9ba1]"
              >
                {d.icon} {d.label}
              </button>
            ))}
          </div>
        </BoundLine>
      </Shell>
    );
  }

  if (state.kind === 'proposal-usual') {
    const { domain, usual, cap } = state;
    const conflict = cap !== null && usual.high > cap;
    return (
      <Shell onDismiss={onDismiss}>
        <BoundLine>
          {conflict ? (
            <>
              <p>
                Based on your recent payments, your usual {domain.label.toLowerCase()} spend is around{' '}
                <span className="font-semibold">{formatINR(usual.high)}</span> — but your current{' '}
                {domain.label} rule allows <span className="font-semibold">{formatINR(cap)}</span>.
              </p>
              <p className="text-[#5a5c63] mt-1">
                History never raises your limit. Use {formatINR(cap)}, or review the rule itself.
              </p>
              <div className="flex gap-2 flex-wrap mt-2.5">
                <button
                  onClick={() => onAcceptBudget(cap)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
                >
                  Use {formatINR(cap)}
                </button>
                <button
                  onClick={onEnterManually}
                  className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer"
                >
                  Review rule
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Based on your recent payments, your usual {domain.label.toLowerCase()} spend is{' '}
                <span className="font-semibold">
                  ₹{Math.round(usual.low).toLocaleString()}–₹{Math.round(usual.high).toLocaleString()}
                </span>{' '}
                ({usual.count} approved payments). Use {formatINR(usual.high)}?
              </p>
              <p className="text-[#5a5c63] mt-1">
                Please confirm — I never spend without your say-so, and your rule still caps the check.
              </p>
              <div className="flex gap-2 flex-wrap mt-2.5">
                <button
                  onClick={() => onAcceptBudget(usual.high)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
                >
                  Use {formatINR(usual.high)}
                </button>
                <button
                  onClick={onEnterManually}
                  className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer"
                >
                  Enter amount
                </button>
              </div>
            </>
          )}
        </BoundLine>
      </Shell>
    );
  }

  if (state.kind === 'proposal-last') {
    const { domain, tx } = state;
    return (
      <Shell onDismiss={onDismiss}>
        <BoundLine>
          <p>
            I found your last {domain.label.toLowerCase()} payment:{' '}
            <span className="font-semibold">
              {tx.merchant} · ₹{tx.rawAmount.toLocaleString()}
            </span>{' '}
            <span className="text-[#76777d]">· {tx.timestamp}</span>
          </p>
          <p className="text-[#5a5c63] mt-1">Use the same merchant and amount? I won&apos;t repeat anything until you confirm.</p>
          <div className="flex gap-2 flex-wrap mt-2.5">
            <button
              onClick={() => onAcceptLast(tx)}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
            >
              Use these
            </button>
            <button
              onClick={onEnterManually}
              className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer"
            >
              Choose different
            </button>
          </div>
        </BoundLine>
      </Shell>
    );
  }

  if (state.kind === 'proposal-cheaper') {
    const { domain, amount, basis } = state;
    return (
      <Shell onDismiss={onDismiss}>
        <BoundLine>
          <p>
            To spend less on {domain.label.toLowerCase()}, I inferred {formatINR(amount)} ({basis}). Use it?
          </p>
          <div className="flex gap-2 flex-wrap mt-2.5">
            <button
              onClick={() => onAcceptBudget(amount)}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
            >
              Use {formatINR(amount)}
            </button>
            <button
              onClick={onEnterManually}
              className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer"
            >
              Enter amount
            </button>
          </div>
        </BoundLine>
      </Shell>
    );
  }

  if (state.kind === 'insufficient') {
    return (
      <Shell onDismiss={onDismiss}>
        <BoundLine>
          <p>{state.what}</p>
          <p className="text-[#5a5c63] mt-1">
            {state.domain
              ? `I need at least 2 approved ${state.domain.label} payments to determine your usual spend. Enter an amount below to continue.`
              : 'Enter the details below to continue.'}
          </p>
        </BoundLine>
      </Shell>
    );
  }

  // spending-answer
  return (
    <Shell onDismiss={onDismiss}>
      <BoundLine>
        {state.items.length === 0 ? (
          <p>
            I found no recorded {state.domain ? state.domain.label.toLowerCase() + ' ' : ''}payments yet.
          </p>
        ) : (
          <>
            <p>
              I found {state.items.length} recent payment{state.items.length === 1 ? '' : 's'}
              {state.domain ? ` for ${state.domain.label}` : ''}:
            </p>
            <ul className="mt-2 space-y-1.5">
              {state.items.map((t) => (
                <li key={t.id} className="text-[13px] text-[#0b1c30] rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2 break-words">
                  <span className="font-medium">{t.merchant}</span> · ₹{t.rawAmount.toLocaleString()}
                  <span className="text-[#76777d]"> · {t.timestamp}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </BoundLine>
    </Shell>
  );
};
