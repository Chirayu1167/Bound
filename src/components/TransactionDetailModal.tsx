import React, { useEffect, useState } from 'react';
import { DelegationChain, ProvenanceEvent, TransactionRecord } from '../types';
import * as api from '../services/api';
import { DecisionBadge, Modal, RiskBadge, TechnicalDetails, TechRow, riskExplanation } from './ui';

export const TransactionDetailModal: React.FC<{ tx: TransactionRecord; onClose: () => void }> = ({ tx, onClose }) => {
  const [events, setEvents] = useState<ProvenanceEvent[]>([]);
  const [chain, setChain] = useState<DelegationChain | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getProvenanceByTransaction(tx.id).catch(() => [] as ProvenanceEvent[]),
      api.getDelegationChain(tx.agent_id).catch(() => ({ delegationId: null, chain: [] }) as DelegationChain),
    ]).then(([ev, ch]) => {
      if (!cancelled) {
        setEvents(ev);
        setChain(ch);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tx.id, tx.agent_id]);

  const factors = tx.risk_factors?.slice(0, 3) || [];

  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
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

      {tx.decision !== 'ALLOW' && (
        <div className="mt-4 rounded-lg bg-[#fdf3f2] border border-[#e8c4c0] px-3 py-2.5">
          <p className="text-[12px] font-medium text-[#93000a]">Why this needs review</p>
          <p className="text-[13px] text-[#0b1c30] mt-0.5">{tx.reason || 'This payment was outside the allowed rule.'}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Risk</p>
        <p className="text-[13px] text-[#0b1c30] mt-1">{riskExplanation(tx.risk_level)}{tx.risk_score != null ? ` (${tx.risk_score}/100)` : ''}</p>
        {factors.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {factors.map((f, i) => (
              <li key={i} className="text-[13px] text-[#45464d] rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2">
                <span className="font-medium text-[#0b1c30]">{f.type}</span> — {f.message || f.severity}
              </li>
            ))}
          </ul>
        )}
      </div>

      {chain && chain.chain.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Delegation chain</p>
          <ol className="mt-2 space-y-1">
            {chain.chain.map((s, i) => (
              <li key={i} className="text-[13px] text-[#0b1c30] flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#eef1f6] text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>
                <span>{s.step}{s.name ? ` — ${s.name}` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[12px] font-medium text-[#76777d] uppercase tracking-wide">Evidence</p>
        {events.length === 0 ? (
          <p className="text-[13px] text-[#76777d] mt-1">No linked audit events found for this payment.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[12px] rounded-lg border border-[#eef0f4] px-3 py-2">
                <span className="font-medium text-[#0b1c30]">{e.event_type}</span>
                <span className="text-[#76777d]"> · {new Date(e.timestamp).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <TechnicalDetails summary="Advanced — technical details">
          <TechRow k="Transaction ID" v={tx.id} />
          <TechRow k="Agent ID" v={tx.agent_id} />
          <TechRow k="Mandate ID" v={tx.mandate_id || '—'} />
          <TechRow k="Delegation ID" v={tx.delegation_id || '—'} />
          <TechRow k="Raw decision" v={tx.decision} />
        </TechnicalDetails>
      </div>
    </Modal>
  );
};
