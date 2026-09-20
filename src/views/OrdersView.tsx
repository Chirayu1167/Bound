/**
 * Bound — Orders & Trips tab.
 *
 * Consumer view of what agents did, built ONLY from real backend records
 * (tasks, approvals, demo payments, recorded transactions). Merchant, amount,
 * agent and every status step come from those records.
 *
 * Last-mile fulfillment (preparing / shipped / delivered, ETAs, seat/flight
 * numbers) is NOT tracked by Bound — the demo ends at payment — so that
 * section is rendered once, greyed, and labeled "Simulated".
 */

import React, { useMemo } from 'react';
import type { ActiveTab, AgentNode, ApprovalItem, MockPaymentItem, TaskItem, TransactionRecord } from '../types';
import type { WalletTx } from '../services/api';
import { EmptyState, TechnicalDetails, TechRow } from '../components/ui';

interface OrdersViewProps {
  tasks: TaskItem[];
  payments: MockPaymentItem[];
  transactions: TransactionRecord[];
  agents: AgentNode[];
  approvals: ApprovalItem[];
  walletTxns: WalletTx[];
  onNavigate: (tab: ActiveTab) => void;
}

type OrderKind = 'food' | 'travel' | 'shopping';

function kindFor(category: string): OrderKind {
  const c = (category || '').toLowerCase();
  if (['airlines', 'hotels', 'transport'].includes(c)) return 'travel';
  if (['dining', 'grocery'].includes(c)) return 'food';
  return 'shopping';
}

const KIND_META: Record<OrderKind, { icon: string; noun: string; simulatedSteps: string[] }> = {
  food: { icon: '🍔', noun: 'Order', simulatedSteps: ['Restaurant accepted', 'Preparing', 'Out for delivery', 'Delivered'] },
  shopping: { icon: '📦', noun: 'Order', simulatedSteps: ['Preparing', 'Shipped', 'Out for delivery', 'Delivered'] },
  travel: { icon: '✈️', noun: 'Booking', simulatedSteps: ['Confirmed with carrier', 'Check-in opens', 'Boarding', 'Arrived'] },
};

export const OrdersView: React.FC<OrdersViewProps> = ({ tasks, payments, transactions, agents, approvals, walletTxns, onNavigate }) => {
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const balanceByPayment = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of walletTxns) {
      if (w.payment_id) m.set(w.payment_id, w.balance_after);
    }
    return m;
  }, [walletTxns]);
  const approvalByTask = useMemo(() => new Map(approvals.map((a) => [a.task_id, a])), [approvals]);
  const paymentByTask = useMemo(() => {
    const m = new Map<string, MockPaymentItem>();
    for (const p of payments) m.set(p.task_id, p);
    return m;
  }, [payments]);
  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

  const orders = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'CANCELLED' && t.status !== 'EXPIRED' && (paymentByTask.has(t.id) || t.status === 'APPROVED' || t.status === 'COMPLETED' || t.status === 'NEEDS_REVIEW'))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [tasks, paymentByTask]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Orders & Trips</h1>
        <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">
          What your agents ordered and booked. Merchants, amounts and statuses are your real Bound records;
          last-mile tracking is simulated.
        </p>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="No orders or trips yet"
          body="Ask for something on Home — approved requests you pay for will show up here."
          action={
            <button onClick={() => onNavigate('wallet')} className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer">
              Make a request
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orders.map((t) => {
            const kind = kindFor(t.category);
            const meta = KIND_META[kind];
            const agent = agentById.get(t.domain_agent_id);
            const approval = approvalByTask.get(t.id) || null;
            const payment = paymentByTask.get(t.id) || null;
            const tx = t.transaction_id ? txById.get(t.transaction_id) || null : null;
            const paid = payment?.status === 'SUCCEEDED';
            const needsReview = t.status === 'NEEDS_REVIEW';
            const bal = payment ? (payment.wallet_balance_after ?? balanceByPayment.get(payment.id) ?? null) : null;
            return (
              <div key={t.id} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-[#f2f3f6] flex items-center justify-center text-[20px] shrink-0">{meta.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#0b1c30] truncate">{t.purpose}</p>
                      <p className="text-[12px] text-[#76777d] truncate">{t.merchant} · {t.category}</p>
                    </div>
                  </div>
                  <p className="text-[16px] font-semibold text-[#0b1c30] shrink-0">₹{t.requested_amount.toLocaleString()}</p>
                </div>

                <p className="text-[12px] text-[#5a5c63] mt-2">
                  {kind === 'travel' ? 'Booked' : 'Ordered'} by <span className="font-medium text-[#0b1c30]">{agent ? agent.name : t.domain_agent_id}</span>
                  {payment && <span className="text-[#76777d]"> · Ref {payment.id.slice(0, 8)}… (demo)</span>}
                </p>

                <ol className="mt-3 space-y-1.5">
                  <Step done label={tx && tx.decision === 'ALLOW' ? 'Order placed' : 'Authorization checked'} sub={tx ? (tx.decision === 'ALLOW' ? 'Within your rule' : tx.reason) : t.reason || t.status} />
                  <Step
                    done={!needsReview}
                    warn={needsReview}
                    label={approval ? (approval.status === 'APPROVED' ? 'Approval granted' : approval.status === 'DENIED' ? 'Approval denied' : 'Approval waiting') : needsReview ? 'No approval available' : 'No approval needed'}
                    sub={approval ? `One-time · ${approval.status.toLowerCase()}` : needsReview ? 'Outside the rule — see Activity' : 'Within your rule'}
                  />
                  <Step done={paid} current={!paid} label={paid ? 'Payment completed (demo)' : payment ? `Payment ${payment.status.toLowerCase()} (demo)` : 'Not paid yet'} sub={paid ? `${payment?.completed_at ? `${new Date(payment.completed_at).toLocaleString()} · ` : ''}${bal != null ? `Balance ₹${bal.toLocaleString()}` : ''}` : payment?.completed_at ? new Date(payment.completed_at).toLocaleString() : undefined} />
                </ol>

                <div className="mt-3 rounded-lg border border-dashed border-[#c6c6cd] bg-[#fafbff] px-3 py-2.5">
                  <p className="text-[11px] font-medium text-[#76777d] uppercase tracking-wide">
                    Simulated fulfillment <span className="normal-case font-normal">· illustrative only</span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {meta.simulatedSteps.map((s, i) => (
                      <span key={s} className="flex items-center gap-1">
                        <span className="text-[12px] text-[#9a9ba1]">○ {s}</span>
                        {i < meta.simulatedSteps.length - 1 && <span className="text-[#e2e3e8]">·</span>}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#76777d] mt-1">Bound stops tracking after the demo payment — no real delivery or carrier data.</p>
                </div>

                <div className="mt-2">
                  <TechnicalDetails summary="Order details">
                    <TechRow k="Task" v={t.id} />
                    {t.transaction_id && <TechRow k="Record" v={t.transaction_id} />}
                    {approval && <TechRow k="Approval" v={`${approval.id} (${approval.status})`} />}
                    {payment && <TechRow k="Payment" v={`${payment.id} (${payment.status})`} />}
                  </TechnicalDetails>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function Step({ done, warn, current, label, sub }: { done?: boolean; warn?: boolean; current?: boolean; label: string; sub?: string | null }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`w-[18px] h-[18px] rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 mt-px ${
          done ? 'bg-[#e6f4ee] text-[#0a6b4a]' : warn ? 'bg-[#fdecea] text-[#93000a]' : current ? 'bg-[#0b1c30] text-white' : 'bg-[#eef1f6] text-[#9a9ba1]'
        }`}
      >
        {done ? '✓' : warn ? '!' : '·'}
      </span>
      <span className="min-w-0">
        <span className="text-[13px] font-medium text-[#0b1c30]">{label}</span>
        {sub && <span className="block text-[12px] text-[#76777d] break-words">{sub}</span>}
      </span>
    </li>
  );
}
