/**
 * Bound — Agent activity feed.
 *
 * One chronological feed built ONLY from real backend records
 * (tasks, approvals, demo payments, recorded transactions). Newest first.
 */

import React, { useMemo } from 'react';
import type { ApprovalItem, MockPaymentItem, TaskItem, TransactionRecord } from '../types';
import { EmptyState } from './ui';

interface ActivityFeedProps {
  transactions: TransactionRecord[];
  tasks: TaskItem[];
  approvals: ApprovalItem[];
  payments: MockPaymentItem[];
  limit?: number;
}

interface FeedItem {
  key: string;
  at: number;
  time: string;
  text: string;
  sub?: string;
  tone: 'ok' | 'bad' | 'neutral';
}

function fmtTime(at: number): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ transactions, tasks, approvals, payments, limit = 20 }) => {
  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    for (const t of tasks) {
      const at = new Date(t.created_at).getTime();
      if (!Number.isFinite(at)) continue;
      out.push({
        key: `task-${t.id}`,
        at,
        time: fmtTime(at),
        text: `${t.purpose} — requested ₹${t.requested_amount.toLocaleString()} at ${t.merchant}`,
        sub: t.status === 'APPROVED' ? 'Approved' : t.status === 'NEEDS_REVIEW' ? 'Needs review' : t.status.charAt(0) + t.status.slice(1).toLowerCase(),
        tone: t.status === 'APPROVED' ? 'ok' : t.status === 'NEEDS_REVIEW' ? 'bad' : 'neutral',
      });
    }
    for (const a of approvals) {
      const raw = a.resolved_at || a.created_at;
      const at = new Date(raw).getTime();
      if (!Number.isFinite(at)) continue;
      out.push({
        key: `appr-${a.id}`,
        at,
        time: fmtTime(at),
        text: a.status === 'APPROVED' ? `One-time approval granted — ₹${a.amount.toLocaleString()}` : a.status === 'DENIED' ? 'Request denied' : 'Approval requested',
        sub: a.status === 'PENDING' ? 'Waiting for you' : undefined,
        tone: a.status === 'APPROVED' ? 'ok' : a.status === 'DENIED' ? 'bad' : 'neutral',
      });
    }
    for (const p of payments) {
      const at = new Date(p.created_at).getTime();
      if (!Number.isFinite(at)) continue;
      out.push({
        key: `pay-${p.id}`,
        at,
        time: fmtTime(at),
        text: p.status === 'SUCCEEDED' ? `Payment completed — ₹${p.amount.toLocaleString()} to ${p.merchant} (demo)` : p.status === 'FAILED' ? `Payment failed — ₹${p.amount.toLocaleString()} to ${p.merchant} (demo)` : `Demo payment started — ₹${p.amount.toLocaleString()} to ${p.merchant}`,
        tone: p.status === 'SUCCEEDED' ? 'ok' : p.status === 'FAILED' ? 'bad' : 'neutral',
      });
    }
    for (const t of transactions) {
      const at = new Date(t.created_at).getTime();
      if (!Number.isFinite(at)) continue;
      out.push({
        key: `tx-${t.id}`,
        at,
        time: fmtTime(at),
        text: t.decision === 'ALLOW' ? `Bound approved ${t.purpose} — ${t.amount} at ${t.merchant}` : `Bound flagged ${t.purpose} — ${t.amount} at ${t.merchant}`,
        sub: t.decision === 'ALLOW' ? undefined : t.reason || undefined,
        tone: t.decision === 'ALLOW' ? 'ok' : 'bad',
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }, [transactions, tasks, approvals, payments, limit]);

  if (items.length === 0) {
    return <EmptyState title="No agent activity yet" body="Requests, decisions, approvals and demo payments will appear here in order." />;
  }

  return (
    <ul className="divide-y divide-[#eef0f4]">
      {items.map((it) => (
        <li key={it.key} className="px-4 py-3 flex items-start gap-3">
          <span
            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
              it.tone === 'ok' ? 'bg-[#0a6b4a]' : it.tone === 'bad' ? 'bg-[#ba1a1a]' : 'bg-[#9a9ba1]'
            }`}
          />
          <div className="min-w-0">
            <p className="text-[13px] text-[#0b1c30] break-words">{it.text}</p>
            <p className="text-[12px] text-[#76777d] mt-0.5 break-words">
              {it.time}
              {it.sub ? ` · ${it.sub}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
};
