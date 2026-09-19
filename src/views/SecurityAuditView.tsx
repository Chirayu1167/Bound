import React, { useState, useEffect } from 'react';
import * as api from '../services/api';
import type { ProvenanceEvent, ProvenanceVerifyResult, TransactionRecord } from '../types';

export const SecurityAuditView: React.FC = () => {
  const [events, setEvents] = useState<ProvenanceEvent[]>([]);
  const [verify, setVerify] = useState<ProvenanceVerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [txEvents, setTxEvents] = useState<ProvenanceEvent[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [showCliModal, setShowCliModal] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [ev, v, txs] = await Promise.all([api.getProvenance(100, 0), api.verifyProvenance(), api.getTransactions()]);
      setEvents(ev);
      setVerify(v);
      setTransactions(txs);
      if (txs.length > 0 && !selectedTx) {
        setSelectedTx(txs[0].id);
      }
    } catch (e) {
      console.error('provenance fetch failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (selectedTx) {
      api.getProvenanceByTransaction(selectedTx).then(setTxEvents).catch(() => setTxEvents([]));
    }
  }, [selectedTx]);

  const handleCopyCli = () => {
    const cmd = `curl http://localhost:4000/provenance/verify | jq`;
    navigator.clipboard?.writeText(cmd);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  const handleExportJson = () => {
    const data = {
      provenance_verify: verify,
      events: events.slice(0, 20),
      selected_transaction: selectedTx,
      tx_events: txEvents,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bound-provenance-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVerify = async () => {
    const v = await api.verifyProvenance();
    setVerify(v);
  };

  if (loading) {
    return (
      <div className="w-full p-12 flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-[#c6c6cd]/30 border-t-[#0051d5] rounded-full animate-spin" />
        <p className="font-mono text-[12px] text-[#76777d]">Loading provenance chain…</p>
      </div>
    );
  }

  const selectedTxRecord = transactions.find((t) => t.id === selectedTx);

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">Hash-linked Evidence Chain</span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">Security & Provenance Audit</h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">Append-only audit events with SHA256 hash chaining. Every authorization is recorded and verifiable as untampered.</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-start md:self-auto">
          <button onClick={handleVerify} className="px-3.5 py-2 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 border border-[#c6c6cd]/30">
            <span className="material-symbols-outlined text-[16px]">verified</span>
            <span>Re-verify</span>
          </button>
          <button onClick={() => setShowCliModal(true)} className="px-3.5 py-2 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 border border-[#c6c6cd]/30">
            <span className="material-symbols-outlined text-[16px]">terminal</span>
            <span>CLI Verify</span>
          </button>
          <button onClick={handleExportJson} className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm">
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Provenance Verification Status */}
      <div className={`p-6 rounded-xl border shadow-xs space-y-4 ${verify?.valid ? 'bg-[#ffffff] border-[#009668]/30' : 'bg-[#ffdad6]/40 border-[#ba1a1a]/30'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`material-symbols-outlined text-[24px] ${verify?.valid ? 'text-[#009668]' : 'text-[#ba1a1a]'}`}>{verify?.valid ? 'verified' : 'warning'}</span>
            <div>
              <h2 className={`font-headline-md text-[18px] font-semibold ${verify?.valid ? 'text-[#0b1c30]' : 'text-[#93000a]'}`}>{verify?.valid ? 'PROVENANCE VERIFIED' : 'PROVENANCE INVALID'}</h2>
              <span className={`font-mono text-[11px] font-medium ${verify?.valid ? 'text-[#009668]' : 'text-[#ba1a1a]'}`}>
                {verify?.valid ? `Chain integrity valid — ${verify.events_checked} events checked` : `Event ${verify?.broken_event_id} failed — ${verify?.reason}`}
              </span>
            </div>
          </div>
          <span className={`font-mono text-[11px] px-2.5 py-1 rounded border font-semibold self-start sm:self-auto ${verify?.valid ? 'bg-[#eff4ff] text-[#0051d5] border-[#c6c6cd]/30' : 'bg-[#ffdad6] text-[#93000a] border-[#ba1a1a]/30'}`}>
            {verify?.valid ? `LAST HASH ${verify.last_hash?.slice(0, 12)}…` : `BROKEN ${verify?.broken_event_id?.slice(0, 12)}…`}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 font-mono text-[11px] text-[#45464d]">
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25">
            <span className="text-[#76777d] block text-[10px] uppercase">Events Checked</span>
            <span className="font-medium text-[#0b1c30] text-[14px]">{verify?.events_checked ?? 0}</span>
            <span className="text-[#76777d] block text-[10px] mt-1">Append-only, no gaps</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25">
            <span className="text-[#76777d] block text-[10px] uppercase">First Event</span>
            <span className="font-medium text-[#0b1c30] break-all text-[11px]">{verify?.first_event ?? '—'}</span>
            <span className="text-[#76777d] block text-[10px] mt-1 truncate">{verify?.first_hash?.slice(0, 20)}…</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25">
            <span className="text-[#76777d] block text-[10px] uppercase">Last Event</span>
            <span className="font-medium text-[#0b1c30] break-all text-[11px]">{verify?.last_event ?? '—'}</span>
            <span className="text-[#76777d] block text-[10px] mt-1 truncate">{verify?.last_hash?.slice(0, 20)}…</span>
          </div>
        </div>
        {verify?.valid ? (
          <p className="text-[11px] text-[#009668] font-mono">Sequence ordering, previous_hash linkage, and SHA256 recomputation all passed. No tampering detected.</p>
        ) : (
          <p className="text-[11px] text-[#ba1a1a] font-mono">Tampering or corruption detected. Expected hash {verify?.expected_hash?.slice(0, 12)}… got {verify?.actual_hash?.slice(0, 12)}…</p>
        )}
      </div>

      {/* Risk Summary — Phase 6 */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#ffb300] text-[20px]">shield</span>
          <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Risk Intelligence — Live Summary</h2>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] border border-[#c6c6cd]/30 text-[#76777d]">{transactions.filter((t: any) => t.risk_score != null).length} evaluations</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[11px]">
          <div className="p-3.5 rounded-lg bg-[#eff4ff]/60 border border-[#c6c6cd]/25 text-center">
            <span className="text-[#76777d] block text-[10px] uppercase">Risk Evaluations</span>
            <span className="font-semibold text-[#0b1c30] text-[18px]">{transactions.filter((t: any) => t.risk_score != null).length}</span>
            <span className="text-[#76777d] block text-[10px]">from SQLite</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#ffdad6]/40 border border-[#ba1a1a]/30 text-center">
            <span className="text-[#93000a] block text-[10px] uppercase">High Risk</span>
            <span className="font-semibold text-[#ba1a1a] text-[18px]">{transactions.filter((t: any) => t.risk_level === 'HIGH').length}</span>
            <span className="text-[#76777d] block text-[10px]">60–100</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#fff8e1] border border-[#ffb300]/30 text-center">
            <span className="text-[#7a4a00] block text-[10px] uppercase">Medium Risk</span>
            <span className="font-semibold text-[#7a4a00] text-[18px]">{transactions.filter((t: any) => t.risk_level === 'MEDIUM').length}</span>
            <span className="text-[#76777d] block text-[10px]">30–59</span>
          </div>
          <div className="p-3.5 rounded-lg bg-[#fff8e1]/60 border border-[#ffb300]/30 text-center">
            <span className="text-[#7a4a00] block text-[10px] uppercase">Verification Interventions</span>
            <span className="font-semibold text-[#0b1c30] text-[18px]">{transactions.filter((t: any) => t.decision === 'VERIFY' && t.authorization_status === 'ALLOW').length}</span>
            <span className="text-[#76777d] block text-[10px]">Auth ALLOW → Risk VERIFY</span>
          </div>
        </div>
        <p className="text-[11px] text-[#76777d] font-mono">High risk never grants authority. Authorization is hard boundary; risk only escalates.</p>
      </div>

      {/* Transaction Evidence Selector */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Transaction Evidence</h2>
            <p className="text-[12px] text-[#76777d]">Select a transaction to see its provenance trail and delegation chain.</p>
          </div>
          <select value={selectedTx || ''} onChange={(e) => setSelectedTx(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white cursor-pointer min-w-[200px]">
            {transactions.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {tx.id} — {tx.agent} — {tx.amount} — {tx.decision}
              </option>
            ))}
          </select>
        </div>

        {selectedTxRecord && (
          <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-[#0b1c30]">{selectedTxRecord.id}</span>
              <span className="text-[#76777d]">·</span>
              <span className="text-[#0b1c30]">{selectedTxRecord.agent}</span>
              <span className="text-[#76777d]">·</span>
              <span className="font-mono font-semibold">{selectedTxRecord.amount}</span>
              <span className={`font-mono text-[11px] px-2 py-0.5 rounded font-semibold border ${selectedTxRecord.decision === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668] border-[#009668]/30' : 'bg-[#ffdad6] text-[#93000a] border-[#ba1a1a]/30'}`}>{selectedTxRecord.decision}</span>
              <span className="text-[#76777d] font-mono text-[11px]">{selectedTxRecord.timestamp}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px] text-[#45464d]">
              <div className="p-2 rounded bg-[#ffffff] border border-[#c6c6cd]/30">
                <span className="text-[#76777d] block text-[10px]">Merchant</span>
                <span className="text-[#0b1c30]">{selectedTxRecord.merchant} · {selectedTxRecord.mcc}</span>
              </div>
              <div className="p-2 rounded bg-[#ffffff] border border-[#c6c6cd]/30">
                <span className="text-[#76777d] block text-[10px]">Action</span>
                <span className="text-[#0b1c30]">{selectedTxRecord.action}</span>
              </div>
            </div>
            {txEvents.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] font-semibold text-[#0b1c30] uppercase tracking-wider">Provenance for this transaction ({txEvents.length} events)</h3>
                <div className="space-y-1.5">
                  {txEvents.map((ev) => (
                    <div key={ev.id} className="p-2.5 rounded-lg bg-[#ffffff] border border-[#c6c6cd]/30 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#eff4ff] text-[#0051d5] border border-[#c6c6cd]/30 font-medium">#{ev.sequence_number} {ev.event_type}</span>
                          {ev.decision && <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold border ${ev.decision === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668] border-[#009668]/30' : 'bg-[#ffdad6] text-[#93000a] border-[#ba1a1a]/30'}`}>{ev.decision}</span>}
                        </div>
                        <p className="text-[11px] text-[#45464d] mt-1 font-mono break-all">hash: {ev.event_hash.slice(0, 16)}… prev: {ev.previous_hash?.slice(0, 12) ?? '∅'}…</p>
                        {ev.reason && <p className="text-[11px] text-[#93000a] mt-1">{ev.reason}</p>}
                        {ev.event_data && <p className="text-[10px] text-[#76777d] font-mono mt-1 break-all">{ev.event_data.slice(0, 120)}…</p>}
                      </div>
                      <span className="font-mono text-[10px] text-[#76777d] whitespace-nowrap">{new Date(ev.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {txEvents.length === 0 && <p className="text-[11px] text-[#76777d] font-mono">No provenance events yet for this transaction (seed transactions may have been created before provenance layer).</p>}
          </div>
        )}
      </div>

      {/* Full Event Timeline */}
      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Provenance Timeline — {events.length} events</h2>
            <p className="text-[12px] text-[#76777d] mt-0.5">Append-only, hash-linked, chronological. Every important state change is recorded.</p>
          </div>
          <span className="font-mono text-[11px] text-[#009668] px-2 py-0.5 rounded bg-[#eff4ff] border border-[#c6c6cd]/30">SEQ 1 → {events.length}</span>
        </div>

        <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-[#c6c6cd]/40 max-h-[600px] overflow-y-auto pr-2">
          {events.slice().reverse().map((ev) => (
            <div key={ev.id} className="relative group">
              <span className={`absolute -left-[27px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[#ffffff] ${ev.event_type.includes('REVOKED') ? 'bg-[#ba1a1a]' : ev.decision === 'VERIFY' ? 'bg-[#ffdad6] border-[#ba1a1a]' : ev.decision === 'ALLOW' ? 'bg-[#009668]' : ev.event_type === 'DELEGATION_CREATED' ? 'bg-[#0051d5]' : 'bg-[#76777d]'}`}></span>
              <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-2 hover:border-[#0051d5]/40 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-headline-sm text-[13px] font-semibold text-[#0b1c30]">#{ev.sequence_number} {ev.event_type}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#ffffff] text-[#0051d5] border border-[#c6c6cd]/30 font-medium">seq {ev.sequence_number}</span>
                    {ev.decision && <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold border ${ev.decision === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668] border-[#009668]/30' : 'bg-[#ffdad6] text-[#93000a] border-[#ba1a1a]/30'}`}>{ev.decision}</span>}
                  </div>
                  <span className="font-mono text-[11px] text-[#76777d]">{new Date(ev.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px] text-[#45464d]">
                  {ev.actor_agent_id && <div><span className="text-[#76777d]">Actor:</span> <span className="text-[#0b1c30]">{ev.actor_agent_id}</span></div>}
                  {ev.delegation_id && <div><span className="text-[#76777d]">Delegation:</span> <span className="text-[#0b1c30]">{ev.delegation_id}</span></div>}
                  {ev.transaction_id && <div><span className="text-[#76777d]">Tx:</span> <span className="text-[#0b1c30]">{ev.transaction_id}</span></div>}
                  {ev.mandate_id && <div><span className="text-[#76777d]">Mandate:</span> <span className="text-[#0b1c30]">{ev.mandate_id}</span></div>}
                  {ev.parent_agent_id && <div><span className="text-[#76777d]">Parent:</span> <span className="text-[#0b1c30]">{ev.parent_agent_id}</span></div>}
                </div>
                {ev.reason && <p className="text-[12px] text-[#45464d] leading-relaxed font-mono bg-[#ffffff]/60 p-2 rounded border border-[#c6c6cd]/20">{ev.reason}</p>}
                <div className="pt-2 border-t border-[#c6c6cd]/25 space-y-1 font-mono text-[10px] text-[#76777d]">
                  <div className="flex items-center gap-2 break-all">
                    <span>hash:</span> <span className="text-[#0b1c30] font-medium">{ev.event_hash.slice(0, 24)}…</span>
                    <span>prev:</span> <span className="text-[#0b1c30]">{ev.previous_hash?.slice(0, 16) ?? 'genesis'}…</span>
                  </div>
                  {ev.event_data && <div className="break-all"><span>data:</span> <span className="text-[#0b1c30]">{ev.event_data.slice(0, 120)}…</span></div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CLI Verification Modal */}
      {showCliModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-4 border border-[#c6c6cd]/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#0051d5] text-[20px]">terminal</span>
                <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Verify Chain Offline</h3>
              </div>
              <button onClick={() => setShowCliModal(false)} className="text-[#45464d] hover:text-[#0b1c30] cursor-pointer">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <p className="text-[12px] text-[#45464d]">Run any of these against the backend to verify tamper-evidence:</p>
            <div className="p-3 rounded-lg bg-[#131b2e] text-[#f8f9ff] font-mono text-[11px] break-all leading-relaxed space-y-1">
              <div>curl http://localhost:4000/provenance/verify | jq</div>
              <div>curl http://localhost:4000/provenance | jq '.[].event_hash'</div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#c6c6cd]/20">
              <button onClick={() => setShowCliModal(false)} className="px-3.5 py-2 rounded text-[12px] font-medium text-[#0b1c30] hover:bg-[#eff4ff] transition-colors cursor-pointer">Close</button>
              <button onClick={handleCopyCli} className="px-4 py-2 rounded text-[12px] font-medium bg-[#000000] text-[#ffffff] hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm">
                <span className="material-symbols-outlined text-[16px]">{copiedCli ? 'check' : 'content_copy'}</span>
                <span>{copiedCli ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
