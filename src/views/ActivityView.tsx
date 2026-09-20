import React, { useEffect, useMemo, useState } from 'react';
import { AgentNode, ApprovalItem, DelegationChain, MandateItem, MockPaymentItem, ProvenanceEvent, TaskItem, TransactionRecord } from '../types';
import * as api from '../services/api';
import type { WalletTx } from '../services/api';
import { DecisionBadge, EmptyState, RiskBadge, TechnicalDetails, TechRow, riskExplanation } from '../components/ui';
import { WhyPanel } from '../components/WhyPanel';

interface ActivityViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  walletTxns: WalletTx[];
  transactions: TransactionRecord[];
  tasks: TaskItem[];
  approvals: ApprovalItem[];
  payments: MockPaymentItem[];
  selected: TransactionRecord | null;
  onSelect: (tx: TransactionRecord | null) => void;
  onAuthorize: (payload: { agent_id: string; amount: number; merchant: string; merchant_category: string; purpose: string }) => Promise<api.AuthorizeResult>;
  onRefresh: () => Promise<void>;
}

const CATEGORIES = ['Grocery', 'Airlines', 'Dining', 'Fuel', 'General'];

function topFactors(tx: TransactionRecord): TransactionRecord['risk_factors'] {
  if (!tx.risk_factors || tx.risk_factors.length === 0) return null;
  return tx.risk_factors.slice(0, 3);
}

export const ActivityView: React.FC<ActivityViewProps> = ({ agents, mandates, walletTxns, transactions, tasks, approvals, payments, selected, onSelect, onAuthorize, onRefresh }) => {
  const [filter, setFilter] = useState<'all' | 'approved' | 'review'>('all');
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [amount, setAmount] = useState('800');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [purpose, setPurpose] = useState('Groceries');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<api.AuthorizeResult | null>(null);

  useEffect(() => {
    const eligible = agents.filter((a) => !a.is_task_agent);
    if (eligible.length > 0 && !eligible.find((a) => a.id === agentId)) {
      setAgentId(eligible[0].id);
    }
  }, [agents, agentId]);

  const taskByTx = useMemo(() => {
    const m = new Map<string, TaskItem>();
    for (const t of tasks) {
      if (t.transaction_id) m.set(t.transaction_id, t);
    }
    return m;
  }, [tasks]);
  const approvalByTask = useMemo(() => new Map(approvals.map((a) => [a.task_id, a])), [approvals]);
  const paymentByTx = useMemo(() => {
    const m = new Map<string, MockPaymentItem>();
    for (const p of payments) {
      if (p.transaction_id) m.set(p.transaction_id, p);
    }
    return m;
  }, [payments]);
  const balanceByPayment = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of walletTxns) {
      if (w.payment_id) m.set(w.payment_id, w.balance_after);
    }
    return m;
  }, [walletTxns]);

  const filtered = useMemo(() => {
    if (filter === 'approved') return transactions.filter((t) => t.decision === 'ALLOW');
    if (filter === 'review') return transactions.filter((t) => t.decision !== 'ALLOW');
    return transactions;
  }, [transactions, filter]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setResult(null);
    const amt = parseFloat(amount);
    if (!agentId) {
      setFormError('Select an agent.');
      return;
    }
    if (!amt || amt <= 0) {
      setFormError('Enter an amount greater than zero.');
      return;
    }
    if (!merchant.trim()) {
      setFormError('Enter a merchant name.');
      return;
    }
    setBusy(true);
    try {
      const res = await onAuthorize({
        agent_id: agentId,
        amount: amt,
        merchant: merchant.trim(),
        merchant_category: category,
        purpose: purpose.trim() || category,
      });
      setResult(res);
      await onRefresh();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Authorization failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Activity</h1>
        <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">Every payment attempt with its decision. Select a row for the reason, risk, and evidence.</p>
      </div>

      {/* New payment — real authorize, honest wording */}
      <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
        <h2 className="text-[15px] font-semibold text-[#0b1c30]">Try a payment</h2>
        <p className="text-[12px] text-[#5a5c63] mt-0.5">Runs the real authorization check and records the decision. If the category or amount is outside the agent's rule, it will need review.</p>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Agent</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full px-3 py-2 bg-white rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] cursor-pointer">
              {agents.length === 0 && <option value="">No agents</option>}
              {agents.filter((a) => !a.is_task_agent).map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.status === 'ACTIVE' ? 'Active' : 'Revoked'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Amount (₹)</label>
            <input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5]" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Merchant</label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Corner Store" className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1]" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPurpose((p) => (p === category || p === '' ? e.target.value : p)); }} className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] cursor-pointer">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#0b1c30] block mb-1">Purpose</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is this for?" className="w-full px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] placeholder:text-[#9a9ba1]" />
          </div>
          <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-between gap-3 pt-1">
            <div className="text-[12px] min-w-0">
              {formError ? (
                <span className="text-[#93000a]">{formError}</span>
              ) : result ? (
                <span className={result.decision === 'ALLOW' ? 'text-[#0a6b4a]' : 'text-[#93000a]'}>
                  {result.decision === 'ALLOW' ? 'Approved' : 'Needs review'} — {result.reason}
                </span>
              ) : (
                <span className="text-[#76777d]">The decision and reason will appear here.</span>
              )}
            </div>
            <button type="submit" disabled={busy || agents.length === 0} className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60 shrink-0">
              {busy ? 'Checking…' : 'Check payment'}
            </button>
          </div>
        </form>
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-1 rounded-lg bg-[#f2f3f6] w-fit">
        {([
          { id: 'all', label: `All (${transactions.length})` },
          { id: 'approved', label: `Approved (${transactions.filter((t) => t.decision === 'ALLOW').length})` },
          { id: 'review', label: `Needs review (${transactions.filter((t) => t.decision !== 'ALLOW').length})` },
        ] as const).map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1.5 rounded-md text-[13px] cursor-pointer ${filter === f.id ? 'bg-white font-semibold shadow-sm text-[#0b1c30]' : 'text-[#5a5c63]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          title={transactions.length === 0 ? 'No payments yet' : 'Nothing in this filter'}
          body={transactions.length === 0 ? 'Payment attempts will appear here once you try one above.' : 'Try a different filter.'}
        />
      ) : (
        <div className="rounded-xl bg-white border border-[#e2e3e8] overflow-hidden">
          <ul className="divide-y divide-[#eef0f4]">
            {filtered.map((t) => {
              const pay = paymentByTx.get(t.id);
              const bal = pay ? balanceByPayment.get(pay.id) : undefined;
              return (
              <li key={t.id}>
                <button onClick={() => onSelect(t)} className="w-full text-left px-4 py-3.5 hover:bg-[#f7f8fb] cursor-pointer flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#0b1c30]">
                      <span className="font-semibold">{t.amount}</span> · {t.merchant} <span className="text-[#76777d]">· {t.merchant_category}</span>
                    </p>
                    <p className="text-[12px] text-[#76777d] mt-0.5 truncate">{t.agent} · {t.timestamp}{t.reason && t.decision !== 'ALLOW' ? ` · Why? ${t.reason}` : ''}{bal != null ? ` · Balance ₹${bal.toLocaleString()}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {taskByTx.has(t.id) && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#eef1f6] text-[#0b1c30]">Task</span>
                    )}
                    {paymentByTx.get(t.id)?.status === 'SUCCEEDED' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#e6f4ee] text-[#0a6b4a]">Paid (demo)</span>
                    )}
                    <span className="hidden sm:inline"><RiskBadge level={t.risk_level} /></span>
                    <DecisionBadge decision={t.decision} />
                  </div>
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected && (
        <TransactionDrawer
          tx={selected}
          agents={agents}
          mandates={mandates}
          balanceAfter={(() => {
            const pay = paymentByTx.get(selected.id);
            return pay ? balanceByPayment.get(pay.id) ?? null : null;
          })()}
          task={taskByTx.get(selected.id) || null}
          approval={(() => {
            const task = taskByTx.get(selected.id);
            return task ? approvalByTask.get(task.id) || null : null;
          })()}
          payment={paymentByTx.get(selected.id) || null}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  );
};

/** Compact lifecycle: Request → Authorized → Approval → Payment → Completed, derived from real records. */
function LifecycleStrip({ tx, task, approval, payment }: { tx: TransactionRecord; task: TaskItem | null; approval: ApprovalItem | null; payment: MockPaymentItem | null }) {
  type State = 'done' | 'current' | 'todo' | 'bad';
  const steps: Array<{ label: string; state: State; sub?: string }> = [
    { label: 'Request', state: 'done', sub: task ? task.purpose : tx.purpose },
  ];
  if (tx.decision === 'ALLOW' || (task && (task.status === 'APPROVED' || task.status === 'COMPLETED'))) {
    steps.push({ label: 'Authorized', state: 'done', sub: 'Approved' });
  } else {
    steps.push({ label: 'Authorized', state: 'bad', sub: 'Needs review' });
  }
  if (!approval) {
    steps.push({ label: 'Approval', state: 'todo', sub: task ? 'None' : 'N/A' });
  } else if (approval.status === 'APPROVED') {
    steps.push({ label: 'Approval', state: 'done', sub: 'Approved once' });
  } else if (approval.status === 'PENDING') {
    steps.push({ label: 'Approval', state: 'current', sub: 'Waiting' });
  } else {
    steps.push({ label: 'Approval', state: 'bad', sub: approval.status.charAt(0) + approval.status.slice(1).toLowerCase() });
  }
  if (!payment) {
    steps.push({ label: 'Payment', state: 'todo', sub: 'Not started' });
  } else if (payment.status === 'SUCCEEDED') {
    steps.push({ label: 'Payment', state: 'done', sub: 'Paid (demo)' });
  } else if (payment.status === 'FAILED') {
    steps.push({ label: 'Payment', state: 'bad', sub: 'Failed' });
  } else {
    steps.push({ label: 'Payment', state: 'current', sub: payment.status.charAt(0) + payment.status.slice(1).toLowerCase() });
  }
  const completed = (task && task.status === 'COMPLETED') || payment?.status === 'SUCCEEDED';
  steps.push({ label: 'Completed', state: completed ? 'done' : 'todo', sub: completed ? 'Done' : undefined });
  return (
    <div>
      <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Lifecycle</p>
      <ol className="mt-2 space-y-0">
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${
                  s.state === 'done'
                    ? 'bg-[#e6f4ee] text-[#0a6b4a]'
                    : s.state === 'current'
                      ? 'bg-[#0b1c30] text-white'
                      : s.state === 'bad'
                        ? 'bg-[#fdecea] text-[#93000a]'
                        : 'bg-[#eef1f6] text-[#9a9ba1]'
                }`}
              >
                {s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : i + 1}
              </span>
              {i < steps.length - 1 && <span className="w-px flex-1 bg-[#e2e3e8] min-h-2" />}
            </div>
            <div className="pb-2.5 min-w-0">
              <p className={`text-[13px] ${s.state === 'todo' ? 'text-[#76777d]' : 'text-[#0b1c30] font-medium'} break-words`}>{s.label}</p>
              {s.sub && <p className="text-[12px] text-[#76777d] break-words">{s.sub}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TransactionDrawer({ tx, agents, mandates, balanceAfter, task, approval, payment, onClose }: { tx: TransactionRecord; agents: AgentNode[]; mandates: MandateItem[]; balanceAfter: number | null; task: TaskItem | null; approval: ApprovalItem | null; payment: MockPaymentItem | null; onClose: () => void }) {
  const [events, setEvents] = useState<ProvenanceEvent[]>([]);
  const [chain, setChain] = useState<DelegationChain | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getProvenanceByTransaction(tx.id).catch(() => [] as ProvenanceEvent[]),
      api.getDelegationChain(tx.agent_id).catch(() => ({ delegationId: null, chain: [] }) as DelegationChain),
    ]).then(([ev, ch]) => {
      if (!cancelled) {
        setEvents(ev);
        setChain(ch);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tx.id, tx.agent_id]);

  const factors = topFactors(tx);
  const showChain = chain && chain.chain.length > 0;
  const agent = agents.find((a) => a.id === tx.agent_id) || null;
  const mandate = mandates.find((m) => m.id === tx.mandate_id) || null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#131b2e]/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l border-[#e2e3e8] overflow-y-auto">
        <div className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <DecisionBadge decision={tx.decision} />
                <RiskBadge level={tx.risk_level} />
              </div>
              <h2 className="text-[17px] font-semibold text-[#0b1c30] mt-2">{tx.amount} · {tx.merchant}</h2>
              <p className="text-[13px] text-[#5a5c63] mt-0.5">{tx.agent} · {tx.timestamp} · {tx.merchant_category}</p>
            </div>
            <button onClick={onClose} className="px-2.5 py-1.5 rounded-lg bg-[#eef1f6] text-[13px] hover:bg-[#e2e7f0] cursor-pointer shrink-0">Close</button>
          </div>

          <LifecycleStrip tx={tx} task={task} approval={approval} payment={payment} />

          <WhyPanel
            agentName={tx.agent}
            agentActive={!agent || agent.status === 'ACTIVE'}
            cap={mandate ? mandate.max_amount : null}
            ruleCategory={mandate ? mandate.merchant_category : null}
            rulePurpose={mandate ? mandate.purpose : null}
            requestedAmount={tx.rawAmount}
            merchant={tx.merchant}
            category={tx.merchant_category}
            purpose={tx.purpose}
            approved={tx.decision === 'ALLOW'}
            reason={tx.reason}
          />

          {task && (
            <div>
              <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Task</p>
              <div className="mt-1.5 rounded-lg border border-[#eef0f4] px-3 py-2.5 space-y-1 text-[13px]">
                <p className="text-[#0b1c30]">
                  <span className="font-medium">{task.purpose}</span> — up to ₹{task.requested_amount.toLocaleString()} at {task.merchant}
                </p>
                <p className="text-[12px] text-[#76777d]">
                  Status: <span className="font-medium text-[#0b1c30]">{task.status === 'APPROVED' ? 'Approved' : task.status === 'NEEDS_REVIEW' ? 'Needs review' : task.status === 'COMPLETED' ? 'Completed' : task.status.charAt(0) + task.status.slice(1).toLowerCase()}</span>
                  {approval ? ` · Approval ${approval.status.charAt(0) + approval.status.slice(1).toLowerCase()}` : ' · No approval'}
                </p>
              </div>
            </div>
          )}

          {payment && (
            <div>
              <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Payment (demo)</p>
              <div className="mt-1.5 rounded-lg border border-[#eef0f4] px-3 py-2.5 space-y-1 text-[13px]">
                <p className="text-[#0b1c30]">
                  <span className="font-medium">₹{payment.amount.toLocaleString()}</span> to {payment.merchant}
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-[11px] font-medium ${payment.status === 'SUCCEEDED' ? 'bg-[#e6f4ee] text-[#0a6b4a]' : payment.status === 'FAILED' ? 'bg-[#fdecea] text-[#93000a]' : 'bg-[#eef1f6] text-[#0b1c30]'}`}>
                    {payment.status === 'SUCCEEDED' ? 'Paid (demo)' : payment.status.charAt(0) + payment.status.slice(1).toLowerCase()}
                  </span>
                </p>
                <p className="text-[12px] text-[#76777d]">
                  Ref: {payment.id} · {payment.payment_method}
                  {payment.completed_at ? ` · ${new Date(payment.completed_at).toLocaleString()}` : ''}
                </p>
                {payment.note && <p className="text-[12px] text-[#5a5c63]">“{payment.note}”</p>}
                {payment.failure_reason && <p className="text-[12px] text-[#93000a]">{payment.failure_reason}</p>}
                {(payment.wallet_balance_after ?? balanceAfter) != null && (
                  <p className="text-[12px] text-[#0b1c30]">Wallet balance after: <span className="font-medium">₹{((payment.wallet_balance_after ?? balanceAfter) as number).toLocaleString()}</span></p>
                )}
                <p className="text-[11px] text-[#76777d]">Simulated — no real funds transferred.</p>
              </div>
            </div>
          )}

          <div>
            <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Risk</p>
            <p className="text-[13px] text-[#0b1c30] mt-1">{riskExplanation(tx.risk_level)}{tx.risk_score != null ? ` (${tx.risk_score}/100)` : ''}</p>
            {factors && factors.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {factors.map((f, i) => (
                  <li key={i} className="text-[13px] text-[#45464d] rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2">
                    <span className="font-medium text-[#0b1c30]">{f.type}</span> — {f.message || f.severity}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#76777d] mt-1">No specific risk factors recorded.</p>
            )}
          </div>

          {showChain && (
            <div>
              <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Delegation chain</p>
              <ol className="mt-2 space-y-1">
                {chain!.chain.map((s, i) => (
                  <li key={i} className="text-[13px] text-[#0b1c30] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#eef1f6] text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>
                    <span>{s.step}{s.name ? ` — ${s.name}` : ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Evidence</p>
            {loading ? (
              <p className="text-[13px] text-[#76777d] mt-1">Loading evidence…</p>
            ) : events.length === 0 ? (
              <p className="text-[13px] text-[#76777d] mt-1">No linked audit events found for this payment.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="text-[12px] rounded-lg border border-[#eef0f4] px-3 py-2">
                    <span className="font-medium text-[#0b1c30]">{e.event_type}</span>
                    <span className="text-[#76777d]"> · #{e.sequence_number} · {new Date(e.timestamp).toLocaleString()}</span>
                    {e.reason && <span className="block text-[#45464d] mt-0.5">{e.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <TechnicalDetails summary="View technical proof">
            {task && <TechRow k="Task ID" v={task.id} />}
            {approval && <TechRow k="Approval ID" v={approval.id} />}
            <TechRow k="Transaction ID" v={tx.id} />
            <TechRow k="Agent ID" v={tx.agent_id} />
            <TechRow k="Mandate ID" v={tx.mandate_id || '—'} />
            <TechRow k="Delegation ID" v={tx.delegation_id || '—'} />
            <TechRow k="Purpose" v={tx.purpose} />
            <TechRow k="Raw decision" v={tx.decision} />
            <TechRow k="Auth status" v={tx.authorization_status || '—'} />
            {events.map((e) => (
              <div key={e.id} className="pt-1.5 mt-1.5 border-t border-[#eef0f4]">
                <TechRow k={`Event #${e.sequence_number} hash`} v={e.event_hash} />
                <TechRow k="Previous hash" v={e.previous_hash || 'genesis'} />
                {e.event_data && <TechRow k="Event data" v={e.event_data.slice(0, 160)} />}
              </div>
            ))}
          </TechnicalDetails>
        </div>
      </div>
    </div>
  );
}
