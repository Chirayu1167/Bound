import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';
import type { ProvenanceEvent, ProvenanceVerifyResult, TransactionRecord } from '../types';
import { EmptyState, SecondaryButton, TechnicalDetails, TechRow } from '../components/ui';

type AuditFilter = 'all' | 'auth' | 'approvals' | 'payments';

const AUTH_EVENTS = new Set([
  'TASK_CREATED', 'TASK_CANCELLED', 'TASK_EXPIRED', 'PAYMENT_REQUESTED',
  'AUTHORIZATION_DECIDED', 'PAYMENT_COMPLETED', 'MANDATE_CREATED', 'MANDATE_REVOKED',
  'AGENT_REGISTERED', 'AGENT_REVOKED', 'DELEGATION_CREATED', 'DELEGATION_REVOKED',
]);
const APPROVAL_EVENTS = new Set(['APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_DENIED']);
const PAYMENT_EVENTS = new Set([
  'MOCK_PAYMENT_CREATED', 'MOCK_PAYMENT_PROCESSING', 'MOCK_PAYMENT_SUCCEEDED', 'MOCK_PAYMENT_FAILED',
]);

function eventGroup(type: string): Exclude<AuditFilter, 'all'> {
  if (APPROVAL_EVENTS.has(type)) return 'approvals';
  if (PAYMENT_EVENTS.has(type)) return 'payments';
  return 'auth';
}

function readableEvent(type: string): string {
  switch (type) {
    case 'AGENT_REGISTERED': return 'Agent registered';
    case 'AGENT_REVOKED': return 'Agent revoked';
    case 'MANDATE_CREATED': return 'Spending rule created';
    case 'MANDATE_REVOKED': return 'Spending rule revoked';
    case 'DELEGATION_CREATED': return 'Delegation created';
    case 'DELEGATION_REVOKED': return 'Delegation revoked';
    case 'PAYMENT_REQUESTED': return 'Payment attempted';
    case 'AUTHORIZATION_DECIDED': return 'Decision recorded';
    case 'PAYMENT_COMPLETED': return 'Payment recorded';
    case 'MOCK_PAYMENT_CREATED': return 'Demo payment created';
    case 'MOCK_PAYMENT_PROCESSING': return 'Demo payment processing';
    case 'MOCK_PAYMENT_SUCCEEDED': return 'Demo payment succeeded';
    case 'MOCK_PAYMENT_FAILED': return 'Demo payment failed';
    case 'MERCHANT_REPORTED': return 'Merchant reported';
    default: return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Simple lifecycle for one payment, derived from its real audit events. */
function PaymentFlow({ events }: { events: ProvenanceEvent[] }) {
  const types = new Set(events.map((e) => e.event_type));
  const steps: Array<{ label: string; state: 'done' | 'todo'; sub: string }> = [
    {
      label: 'Payment requested',
      state: types.has('PAYMENT_REQUESTED') || types.has('TASK_CREATED') ? 'done' : 'todo',
      sub: types.has('TASK_CREATED') ? 'Via task' : 'Recorded attempt',
    },
    {
      label: 'Authorization checked',
      state: types.has('AUTHORIZATION_DECIDED') ? 'done' : 'todo',
      sub: 'Rule + risk engine',
    },
    {
      label: types.has('APPROVAL_DENIED') ? 'Approval denied' : 'Approval granted',
      state: types.has('APPROVAL_GRANTED') || types.has('APPROVAL_DENIED') ? 'done' : 'todo',
      sub: types.has('APPROVAL_REQUESTED') || types.has('APPROVAL_GRANTED') || types.has('APPROVAL_DENIED') ? 'One-time' : 'Not required',
    },
    {
      label: 'Payment completed',
      state: types.has('MOCK_PAYMENT_SUCCEEDED') || types.has('PAYMENT_COMPLETED') ? 'done' : 'todo',
      sub: 'Demo payment',
    },
  ];
  return (
    <ol className="mt-3 flex items-start gap-1">
      {steps.map((s, i) => (
        <li key={s.label} className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${s.state === 'done' ? 'bg-[#e6f4ee] text-[#0a6b4a]' : 'bg-[#eef1f6] text-[#9a9ba1]'}`}>
              {s.state === 'done' ? '✓' : i + 1}
            </span>
            {i < steps.length - 1 && <span className="flex-1 h-px bg-[#e2e3e8] min-w-2" />}
          </div>
          <p className={`text-[12px] mt-1 ${s.state === 'done' ? 'font-medium text-[#0b1c30]' : 'text-[#76777d]'}`}>{s.label}</p>
          <p className="text-[11px] text-[#76777d]">{s.sub}</p>
        </li>
      ))}
    </ol>
  );
}

function TimelineFilter({ filter, onChange }: { filter: AuditFilter; onChange: (f: AuditFilter) => void }) {  const options: Array<{ id: AuditFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'auth', label: 'Authorization' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'payments', label: 'Payments' },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-lg bg-[#f2f3f6] w-fit flex-wrap" role="group" aria-label="Filter timeline">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded-md text-[12px] cursor-pointer ${filter === o.id ? 'bg-white font-semibold shadow-sm text-[#0b1c30]' : 'text-[#5a5c63]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const AuditView: React.FC<{ transactions: TransactionRecord[] }> = ({ transactions }) => {
  const [events, setEvents] = useState<ProvenanceEvent[]>([]);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const filteredEvents = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => eventGroup(e.event_type) === filter)),
    [events, filter]
  );
  const [verify, setVerify] = useState<ProvenanceVerifyResult | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [selectedTx, setSelectedTx] = useState<string>('');
  const [txEvents, setTxEvents] = useState<ProvenanceEvent[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [ev, v] = await Promise.all([api.getProvenance(100, 0), api.verifyProvenance()]);
      setEvents(ev);
      setVerify(v);
      setLastChecked(new Date().toLocaleString());
    } catch {
      // keep empty with message
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (transactions.length > 0 && !selectedTx) setSelectedTx(transactions[0].id);
  }, [transactions, selectedTx]);

  useEffect(() => {
    if (selectedTx) {
      api.getProvenanceByTransaction(selectedTx).then(setTxEvents).catch(() => setTxEvents([]));
    } else {
      setTxEvents([]);
    }
  }, [selectedTx]);

  const reverify = async () => {
    setVerifying(true);
    try {
      const v = await api.verifyProvenance();
      setVerify(v);
      setLastChecked(new Date().toLocaleString());
    } finally {
      setVerifying(false);
    }
  };

  const exportJson = () => {
    const data = { verified: verify, events_checked: verify?.events_checked ?? 0, events: events.slice(0, 50), exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bound-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="w-7 h-7 mx-auto border-[3px] border-[#e2e3e8] border-t-[#0b1c30] rounded-full animate-spin" />
        <p className="text-[13px] text-[#76777d] mt-3">Loading audit log…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Audit</h1>
          <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">A tamper-evident record of what happened. Technical hashes are tucked away unless you need them.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <SecondaryButton onClick={reverify} disabled={verifying}>{verifying ? 'Checking…' : 'Re-check'}</SecondaryButton>
          <SecondaryButton onClick={exportJson}>Export</SecondaryButton>
        </div>
      </div>

      {/* Verification summary */}
      <div className={`rounded-xl border p-4 ${verify?.valid ? 'bg-white border-[#bfe3d2]' : 'bg-[#fdf3f2] border-[#e8c4c0]'}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${verify?.valid ? 'bg-[#0a6b4a]' : 'bg-[#ba1a1a]'}`} />
          <p className="text-[14px] font-semibold text-[#0b1c30]">{verify?.valid ? '✓ Provenance chain valid' : 'Audit log needs attention'}</p>
        </div>
        <p className="text-[13px] text-[#5a5c63] mt-1">
          {verify ? `${verify.events_checked} events checked` : 'No verification result yet'}
          {lastChecked ? ` · last checked ${lastChecked}` : ''}
          {verify && !verify.valid && verify.reason ? ` · ${verify.reason}` : ''}
        </p>
      </div>

      {/* Transaction evidence */}
      <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
        <h2 className="text-[15px] font-semibold text-[#0b1c30]">Evidence for a payment</h2>
        <p className="text-[12px] text-[#5a5c63] mt-0.5">Pick a payment to see what the audit log recorded for it.</p>
        {transactions.length === 0 ? (
          <div className="mt-3"><EmptyState title="No payments to inspect" body="Evidence will appear here once payments exist." /></div>
        ) : (
          <>
            <select value={selectedTx} onChange={(e) => setSelectedTx(e.target.value)} className="mt-3 w-full sm:max-w-md px-3 py-2 rounded-lg text-[13px] border border-[#c6c6cd] outline-none focus:border-[#0051d5] cursor-pointer">
              {transactions.map((t) => (
                <option key={t.id} value={t.id}>{t.id} — {t.agent} — {t.amount}</option>
              ))}
            </select>
            <div className="mt-3">
              {txEvents.length === 0 ? (
                <p className="text-[13px] text-[#76777d]">No audit events found for this payment.</p>
              ) : (
                <>
                  <PaymentFlow events={txEvents} />
                  <ul className="mt-3 space-y-1.5">
                  {txEvents.map((e) => (
                    <li key={e.id} className="text-[13px] rounded-lg border border-[#eef0f4] px-3 py-2">
                      <span className="font-medium text-[#0b1c30]">{readableEvent(e.event_type)}</span>
                      <span className="text-[#76777d]"> · {new Date(e.timestamp).toLocaleString()}</span>
                      {e.reason && <span className="block text-[#45464d] mt-0.5">{e.reason}</span>}
                    </li>
                  ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-[#0b1c30]">Timeline {events.length > 0 && <span className="font-normal text-[#76777d]">· {events.length} events</span>}</h2>
          <TimelineFilter filter={filter} onChange={setFilter} />
        </div>
        <p className="text-[12px] text-[#76777d] mt-1">Demo payments are simulated — no settlement occurred. Authorization, approval, and payment events are grouped separately.</p>
        {filteredEvents.length === 0 ? (
          <div className="mt-3"><EmptyState title={events.length === 0 ? 'Audit log is empty' : 'No events in this group'} body={events.length === 0 ? 'Events will appear here as agents, rules, and payments change.' : 'Try a different group.'} /></div>
        ) : (
          <ol className="mt-4 relative pl-5 space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-[#e2e3e8]">
            {filteredEvents.slice().reverse().map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${e.decision === 'VERIFY' ? 'bg-[#ba1a1a]' : e.event_type.includes('REVOKED') ? 'bg-[#76777d]' : e.decision === 'ALLOW' ? 'bg-[#0a6b4a]' : 'bg-[#0051d5]'}`} />
                <p className="text-[13px] text-[#0b1c30]">
                  <span className="font-medium">{readableEvent(e.event_type)}</span>
                  <span className="text-[#76777d]"> · {new Date(e.timestamp).toLocaleString()}</span>
                </p>
                {e.reason && <p className="text-[13px] text-[#45464d] mt-0.5">{e.reason}</p>}
                <div className="text-[12px] text-[#76777d] mt-0.5">
                  {[e.actor_agent_id ? `agent ${e.actor_agent_id}` : null, e.transaction_id ? `payment ${e.transaction_id}` : null, e.mandate_id ? `rule ${e.mandate_id}` : null, e.delegation_id ? `delegation ${e.delegation_id}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'System event'}
                </div>
                <div className="mt-1.5 max-w-xl">
                  <TechnicalDetails summary="Hashes and raw data">
                    <TechRow k="Event hash" v={e.event_hash} />
                    <TechRow k="Previous hash" v={e.previous_hash || 'genesis'} />
                    <TechRow k="Sequence" v={String(e.sequence_number)} />
                    {e.event_data && <TechRow k="Data" v={e.event_data.slice(0, 200)} />}
                  </TechnicalDetails>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};
