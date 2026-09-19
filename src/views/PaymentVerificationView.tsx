import React, { useState } from 'react';
import { SUPERMARKET_PHOTO_URL } from '../data/mockData';
import { ProofModal } from '../components/ProofModal';
import { AgentNode, TransactionRecord } from '../types';

interface PaymentVerificationViewProps {
  agents?: AgentNode[];
  transactions?: TransactionRecord[];
  onAuthorize?: (payload: { agent_id: string; amount: number; merchant: string; merchant_category: string; purpose: string }) => Promise<{ transaction_id: string; decision: string; reason: string; chain?: any; delegation_id?: string | null; mandate_id?: string | null; authorization_status?: string | null; authorization_reason?: string | null; risk_score?: number | null; risk_level?: string | null; risk_factors?: any[] | null; final_decision?: string | null }>;
  onRefresh?: () => Promise<void>;
}

export const PaymentVerificationView: React.FC<PaymentVerificationViewProps> = ({ agents = [], transactions = [], onAuthorize, onRefresh }) => {
  const [proofOpen, setProofOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>(agents[0]?.id || 'shopping-agent');
  const [amount, setAmount] = useState('800');
  const [merchant, setMerchant] = useState('ABC Supermarket');
  const [merchantCategory, setMerchantCategory] = useState('Grocery');
  const [purpose, setPurpose] = useState('Groceries');
  const [authorizing, setAuthorizing] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (agents.length > 0 && !agents.find((a) => a.id === selectedAgent)) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgent]);

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAuthorize) return;
    setAuthorizing(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await onAuthorize({
        agent_id: selectedAgent,
        amount: parseFloat(amount) || 0,
        merchant: merchant.trim() || 'Unknown Merchant',
        merchant_category: merchantCategory.trim() || 'Grocery',
        purpose: purpose.trim() || 'Groceries',
      });
      setLastResult(res);
      if (onRefresh) await onRefresh();
    } catch (err: any) {
      setError(err.message || 'Authorization failed');
    } finally {
      setAuthorizing(false);
    }
  };

  const handleDownload = () => {
    setDownloading(true);
    setTimeout(() => {
      setDownloading(false);
      const blob = new Blob([JSON.stringify({ event: 'PAYMENT_DECISION_VERIFICATION', tx_id: 'tx_901923', decision: 'ALLOW', latency_ms: 8.4, merchant: { name: 'ABC Supermarket', mcc: '5411', terminal: 'POS-4482', city: 'Bengaluru, IN' }, amount: 820.0, currency: 'INR', rules_evaluated: [{ rule: 'MCC_ALLOWLIST', status: 'PASSED' }, { rule: 'SPENDING_CAP_MANDATE_4091', status: 'PASSED', headroom_remaining: 1180.0 }, { rule: 'DELEGATION_DEPTH', status: 'PASSED', depth: 2, max: 3 }, { rule: 'TEMPORAL_VALIDITY', status: 'PASSED', ttl_remaining_sec: 532 }], cryptographic_evidence: { merkle_leaf: '0x8a91c49b402851a7e930129ef4021980018a1', attestation: 'AWS Nitro PCR0 Validated', zk_system: 'Groth16_BN254' } }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bound-evidence-tx901923.json';
      a.click();
      URL.revokeObjectURL(url);
    }, 400);
  };

  const quickFill = (a: string, amt: string, merch: string, cat: string, purp: string) => {
    setAmount(amt);
    setMerchant(merch);
    setMerchantCategory(cat);
    setPurpose(purp);
    const ag = agents.find((x) => x.name.toLowerCase().includes(a.toLowerCase()) || x.id === a);
    if (ag) setSelectedAgent(ag.id);
  };

  // Helper to generate velocity scenario: create 5 quick txs then test
  const handleVelocityDemo = async () => {
    if (!onAuthorize) return;
    setError(null);
    for (let i = 0; i < 5; i++) {
      try {
        await onAuthorize({ agent_id: selectedAgent, amount: 100, merchant: 'VelocityTest', merchant_category: 'Grocery', purpose: 'Groceries' });
      } catch {}
    }
    if (onRefresh) await onRefresh();
    quickFill(selectedAgent, '100', 'VelocityTest', 'Grocery', 'Groceries');
    setLastResult(null);
    // User can now click Authorize to see elevated risk
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider block mb-1">Deterministic Decision Engine · Audit Record</span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">Payment Decision Verification</h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">Authorization + Risk → Final Decision. Every call is persisted and hash-linked.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#eff4ff] border border-[#009668]/30 text-[#009668] font-mono text-[12px] font-semibold">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            <span>DECISION: ALLOW / VERIFY</span>
          </div>
          <span className="font-mono text-[12px] text-[#76777d]">Live Risk Engine</span>
        </div>
      </div>

      <div className="p-6 rounded-xl bg-[#ffffff] border border-[#0051d5]/30 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[#0051d5] text-[20px]">bolt</span>
              Live Payment Authorization + Risk
            </h2>
            <p className="text-[12px] text-[#76777d] mt-1">Authorization is hard boundary; risk never grants authority. Risk may escalate ALLOW → VERIFY.</p>
          </div>
          {lastResult && (
            <span className={`font-mono text-[11px] px-3 py-1 rounded font-semibold border ${lastResult.decision === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668] border-[#009668]/30' : 'bg-[#ffdad6] text-[#93000a] border-[#ba1a1a]/30'}`}>
              {lastResult.decision} · {lastResult.transaction_id}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
          <span className="text-[#76777d] py-1">Quick tests:</span>
          <button onClick={() => quickFill('shopping-agent', '800', 'ABC Supermarket', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#eff4ff] hover:bg-[#e5eeff] border border-[#c6c6cd]/30 text-[#0051d5]">₹800 Groceries → ALLOW LOW</button>
          <button onClick={() => quickFill('shopping-agent', '3000', 'ABC Supermarket', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#ffdad6]/60 hover:bg-[#ffdad6] border border-[#ba1a1a]/20 text-[#93000a]">₹3,000 → VERIFY (auth)</button>
          <button onClick={() => quickFill('shopping-agent', '1800', 'ABC Supermarket', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#fff8e1] hover:bg-[#ffecb3] border border-[#ffb300]/30 text-[#7a4a00]">₹1,800 → ALLOW but HIGH risk</button>
          <span className="text-[#76777d] py-1 ml-2">| Risk demos:</span>
          <button onClick={handleVelocityDemo} className="px-2 py-1 rounded bg-[#fce4ec] hover:bg-[#f8bbd0] border border-[#e91e63]/30 text-[#880e4f]">Generate velocity (5×100) → then 100 → VERIFY</button>
          <button onClick={() => quickFill('shopping-agent', '800', 'TotallyNewMerchantXYZ123', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#e3f2fd] hover:bg-[#bbdefb] border border-[#2196f3]/30 text-[#0d47a1]">New merchant → risk ↑</button>
          <button onClick={() => quickFill('shopping-agent', '800', 'ABC Supermarket', 'Electronics', 'Electronics')} className="px-2 py-1 rounded bg-[#f3e5f5] hover:bg-[#e1bee7] border border-[#9c27b0]/30 text-[#4a148c]">Electronics (cat anomaly)</button>
          <span className="text-[#76777d] py-1 ml-2">| Delegation:</span>
          <button onClick={() => quickFill('payment-agent', '800', 'ABC Supermarket', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#eff4ff] hover:bg-[#e5eeff] border border-[#009668]/30 text-[#009668]">Payment-Agent ₹800 → ALLOW LOW</button>
          <button onClick={() => quickFill('payment-agent', '1500', 'ABC Supermarket', 'Grocery', 'Groceries')} className="px-2 py-1 rounded bg-[#ffdad6]/60 hover:bg-[#ffdad6] border border-[#ba1a1a]/20 text-[#93000a]">₹1500 → VERIFY (deleg limit)</button>
        </div>

        <form onSubmit={handleAuthorize} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[#0b1c30]">Agent</label>
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white cursor-pointer">
              {agents.length === 0 ? <option value="shopping-agent">shopping-agent</option> : agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[#0b1c30]">Amount (INR)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[#0b1c30]">Merchant</label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} required placeholder="ABC Supermarket" className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[#0b1c30]">Merchant Category</label>
            <input value={merchantCategory} onChange={(e) => setMerchantCategory(e.target.value)} required placeholder="Grocery" className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[#0b1c30]">Purpose</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} required placeholder="Groceries" className="px-3 py-2 bg-[#eff4ff] rounded text-[13px] text-[#0b1c30] border border-[#c6c6cd]/40 outline-none focus:border-[#0051d5] focus:bg-white" />
          </div>
          <div className="lg:col-span-5 flex items-center justify-between pt-2 border-t border-[#c6c6cd]/20">
            <div className="text-[11px] font-mono max-w-[60%]">
              {lastResult ? (
                <span className={lastResult.decision === 'ALLOW' ? 'text-[#009668]' : 'text-[#ba1a1a]'}>
                  {lastResult.decision}: {lastResult.reason}
                  {lastResult.authorization_status && <span className="text-[#76777d]"> | Auth: {lastResult.authorization_status} | Risk: {lastResult.risk_level} {lastResult.risk_score}/100</span>}
                </span>
              ) : error ? (
                <span className="text-[#ba1a1a]">{error}</span>
              ) : (
                <span className="text-[#76777d]">Backend: {import.meta.env.VITE_API_URL || 'http://localhost:4000'}</span>
              )}
            </div>
            <button type="submit" disabled={authorizing} className="px-4 py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-60">
              <span className="material-symbols-outlined text-[16px]">{authorizing ? 'hourglass_empty' : 'verified'}</span>
              <span>{authorizing ? 'Authorizing…' : 'Authorize Payment'}</span>
            </button>
          </div>
        </form>

        {lastResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-[#c6c6cd]/20">
            <div className={`p-4 rounded-xl border text-center space-y-1 ${lastResult.authorization_status === 'ALLOW' ? 'bg-[#eff4ff] border-[#009668]/30' : 'bg-[#ffdad6]/40 border-[#ba1a1a]/30'}`}>
              <span className="text-[11px] font-mono text-[#76777d] uppercase">Authorization</span>
              <div className={`font-headline-md text-[18px] font-semibold ${lastResult.authorization_status === 'ALLOW' ? 'text-[#009668]' : 'text-[#ba1a1a]'}`}>{lastResult.authorization_status || (lastResult.decision === 'ALLOW' ? 'ALLOW' : 'VERIFY')}</div>
              <p className="text-[11px] text-[#45464d] font-mono break-words">{lastResult.authorization_reason || lastResult.reason}</p>
            </div>
            <div className={`p-4 rounded-xl border text-center space-y-1 ${lastResult.risk_level === 'HIGH' ? 'bg-[#ffdad6]/40 border-[#ba1a1a]/30' : lastResult.risk_level === 'MEDIUM' ? 'bg-[#fff8e1] border-[#ffb300]/30' : 'bg-[#eff4ff] border-[#c6c6cd]/30'}`}>
              <span className="text-[11px] font-mono text-[#76777d] uppercase">Risk</span>
              <div className={`font-headline-md text-[18px] font-semibold ${lastResult.risk_level === 'HIGH' ? 'text-[#ba1a1a]' : lastResult.risk_level === 'MEDIUM' ? 'text-[#7a4a00]' : 'text-[#009668]'}`}>{lastResult.risk_level || 'LOW'} {lastResult.risk_score != null ? `· ${lastResult.risk_score}/100` : ''}</div>
              <div className="w-full bg-[#eff4ff] h-1.5 rounded-full overflow-hidden">
                <div className={`h-full ${lastResult.risk_level === 'HIGH' ? 'bg-[#ba1a1a]' : lastResult.risk_level === 'MEDIUM' ? 'bg-[#ffb300]' : 'bg-[#009668]'}`} style={{ width: `${Math.min(100, lastResult.risk_score || 0)}%` }}></div>
              </div>
            </div>
            <div className={`p-4 rounded-xl border text-center space-y-1 ${lastResult.decision === 'ALLOW' ? 'bg-[#eff4ff] border-[#009668]/30' : 'bg-[#ffdad6]/60 border-[#ba1a1a]/40'}`}>
              <span className="text-[11px] font-mono text-[#76777d] uppercase">Final Decision</span>
              <div className={`font-headline-lg text-[22px] font-semibold ${lastResult.decision === 'ALLOW' ? 'text-[#009668]' : 'text-[#ba1a1a]'}`}>{lastResult.decision}</div>
              <p className="text-[11px] text-[#45464d] font-mono">{lastResult.decision === 'ALLOW' ? 'Allowed' : 'Requires Verification'}</p>
            </div>
          </div>
        )}

        {lastResult?.risk_factors && lastResult.risk_factors.length > 0 && (
          <div className="p-4 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 space-y-2">
            <h3 className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5"><span className="material-symbols-outlined text-[#ffb300] text-[16px]">warning</span> Risk Factors — why risk increased</h3>
            <div className="space-y-2">
              {lastResult.risk_factors.map((f: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-[#eff4ff]/40 border border-[#c6c6cd]/20">
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5 ${f.severity === 'HIGH' ? 'bg-[#ffdad6] text-[#93000a] border border-[#ba1a1a]/30' : f.severity === 'MEDIUM' ? 'bg-[#fff8e1] text-[#7a4a00] border border-[#ffb300]/30' : 'bg-[#eff4ff] text-[#009668] border border-[#009668]/30'}`}>{f.severity}</span>
                  <div>
                    <span className="font-mono text-[11px] font-semibold text-[#0b1c30]">{f.type}</span>
                    <p className="text-[11px] text-[#45464d]">{f.message}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#76777d] font-mono">Risk never grants authority. If authorization is invalid, final is VERIFY regardless of LOW risk.</p>
          </div>
        )}

        {lastResult?.chain && lastResult.chain.length > 0 && (
          <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#0051d5]/30 space-y-2">
            <h3 className="font-headline-sm text-[13px] font-semibold text-[#0b1c30] flex items-center gap-1.5"><span className="material-symbols-outlined text-[#0051d5] text-[16px]">account_tree</span> Delegation Chain</h3>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#45464d]">
              {lastResult.chain.map((s: any, idx: number) => (
                <span key={idx} className="flex items-center gap-1.5">
                  <span className={`px-2 py-1 rounded border ${s.step.includes('User') ? 'bg-[#000000] text-[#ffffff] border-[#000000]' : s.step.includes('Root') ? 'bg-[#ffffff] text-[#0051d5] border-[#0051d5]/30' : s.step.includes('Parent') ? 'bg-[#0051d5] text-[#ffffff] border-[#0051d5]' : s.step.includes('Child') ? 'bg-[#009668] text-[#ffffff] border-[#009668]' : 'bg-[#eff4ff] text-[#0b1c30] border-[#c6c6cd]/30'}`}>{s.step}{s.name ? `: ${s.name}` : ''}</span>
                  {idx < lastResult.chain!.length - 1 && <span className="text-[#0051d5] font-bold">→</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {transactions.length > 0 && (
          <div className="pt-4 border-t border-[#c6c6cd]/20">
            <h3 className="text-[12px] font-semibold text-[#0b1c30] mb-2">Recent Live Transactions (from SQLite)</h3>
            <div className="overflow-x-auto rounded-lg border border-[#c6c6cd]/30">
              <table className="w-full text-left text-[12px] border-collapse">
                <thead><tr className="bg-[#eff4ff]/60 text-[11px] font-mono text-[#76777d] uppercase"><th className="py-2 px-3">Time</th><th className="py-2 px-3">Agent</th><th className="py-2 px-3">Merchant</th><th className="py-2 px-3">Amount</th><th className="py-2 px-3">Auth</th><th className="py-2 px-3">Risk</th><th className="py-2 px-3">Final</th></tr></thead>
                <tbody className="divide-y divide-[#c6c6cd]/20">
                  {transactions.slice(0, 8).map((tx: any) => (
                    <tr key={tx.id} className="hover:bg-[#eff4ff]/40">
                      <td className="py-2 px-3 font-mono text-[#76777d]">{tx.time}</td>
                      <td className="py-2 px-3">{tx.agent}</td>
                      <td className="py-2 px-3">{tx.merchant}</td>
                      <td className="py-2 px-3 font-mono">{tx.amount}</td>
                      <td className="py-2 px-3"><span className={`font-mono text-[10px] px-1 py-0.5 rounded ${tx.authorization_status === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668]' : tx.authorization_status ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-[#eff4ff] text-[#76777d]'}`}>{tx.authorization_status || '—'}</span></td>
                      <td className="py-2 px-3"><span className={`font-mono text-[10px] px-1 py-0.5 rounded ${tx.risk_level === 'HIGH' ? 'bg-[#ffdad6] text-[#93000a]' : tx.risk_level === 'MEDIUM' ? 'bg-[#fff8e1] text-[#7a4a00]' : tx.risk_level === 'LOW' ? 'bg-[#eff4ff] text-[#009668]' : 'bg-[#eff4ff] text-[#76777d]'}`}>{tx.risk_level ? `${tx.risk_level} ${tx.risk_score}` : '—'}</span></td>
                      <td className="py-2 px-3"><span className={`font-mono text-[11px] px-1.5 py-0.5 rounded font-semibold ${tx.decision === 'ALLOW' ? 'bg-[#eff4ff] text-[#009668]' : 'bg-[#ffdad6] text-[#93000a]'}`}>{tx.decision}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-[#eff4ff]/50 border border-[#c6c6cd]/30 flex items-center gap-2 text-[12px] text-[#45464d]">
        <span className="material-symbols-outlined text-[#0051d5] text-[18px]">info</span>
        <span>Below is a static example evaluation (Tx #901923 · ABC Supermarket · ₹820 ALLOW) — the live engine above handles real requests with risk.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 opacity-90">
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Request Summary</h2>
              <span className="font-mono text-[11px] text-[#76777d]">Today, 12:42:09 IST</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30">
              <img src={SUPERMARKET_PHOTO_URL} alt="ABC Supermarket" className="w-16 h-16 rounded-lg object-cover border border-[#c6c6cd]/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-headline-sm text-[16px] text-[#0b1c30] font-semibold">ABC Supermarket</h3>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#ffffff] text-[#0051d5] border border-[#c6c6cd]/30">MCC 5411 · Groceries</span>
                </div>
                <p className="text-[12px] text-[#45464d] mt-0.5">Point of Sale 4482 · Bengaluru, IN (Verified Hardware Terminal)</p>
                <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-[#76777d]">
                  <span>Initiated by:</span>
                  <span className="text-[#0b1c30] font-medium">Shopping Agent</span>
                  <span>(sub-delegated to Payment Agent)</span>
                </div>
              </div>
              <div className="sm:text-right shrink-0">
                <span className="text-[11px] text-[#76777d] block">Requested Amount</span>
                <span className="font-mono text-[22px] font-semibold text-[#0b1c30]">₹820.00</span>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Authorization Evaluation</h2>
              <span className="font-mono text-[11px] text-[#009668] flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>4 / 4 Rules Enforced
              </span>
            </div>
            <div className="space-y-2.5 divide-y divide-[#c6c6cd]/20 font-body-sm">
              <div className="pt-2 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[13px] font-medium text-[#0b1c30] block">1. Merchant Category Code (MCC)</span>
                  <span className="text-[12px] text-[#76777d]">MCC 5411 is explicitly allowed under Mandate #MND-4091.</span>
                </div>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#009668] font-semibold">PASSED</span>
              </div>
              <div className="pt-2 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[13px] font-medium text-[#0b1c30] block">2. Spending Threshold & Budget Ceiling</span>
                  <span className="text-[12px] text-[#76777d]">₹820 ≤ ₹2,000 cap. Remaining mandate headroom: ₹1,180.</span>
                </div>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#009668] font-semibold">PASSED</span>
              </div>
              <div className="pt-2 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[13px] font-medium text-[#0b1c30] block">3. Autonomous Sub-Delegation Depth</span>
                  <span className="text-[12px] text-[#76777d]">Chain depth: 2 (Principal → Shopping → Payment). Max permissible: 3.</span>
                </div>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#009668] font-semibold">PASSED</span>
              </div>
              <div className="pt-2 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[13px] font-medium text-[#0b1c30] block">4. Temporal Validity Window</span>
                  <span className="text-[12px] text-[#76777d]">Token generated 12:42:01 IST. Valid until 12:52:01 IST (10m TTL).</span>
                </div>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#009668] font-semibold">PASSED</span>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Autonomous Risk Assessment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#76777d]">Behavioral Anomaly Score</span>
                  <span className="font-mono text-[12px] font-semibold text-[#009668]">0.02 / 1.00 (Low Risk)</span>
                </div>
                <div className="w-full bg-[#e5eeff] h-2 rounded-full overflow-hidden">
                  <div className="bg-[#009668] h-full w-[2%] rounded-full"></div>
                </div>
                <p className="text-[11px] text-[#45464d]">Routine grocery merchant previously approved. Order volume conforms to historical profile.</p>
              </div>
              <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1.5">
                <span className="text-[12px] text-[#76777d] block">Velocity Rate Limit</span>
                <span className="font-mono text-[14px] font-semibold text-[#0b1c30] block">1.2 txn / hr</span>
                <span className="text-[11px] text-[#45464d] block">Well below agent constraint threshold of 5.0 txn / hr.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Delegation Lineage</h2>
              <span className="material-symbols-outlined text-[#0051d5] text-[20px]">account_tree</span>
            </div>
            <div className="relative pl-6 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#c6c6cd]/40 font-mono text-[11px]">
              <div className="relative">
                <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-[#000000] border-2 border-[#ffffff]"></span>
                <span className="text-[#76777d] block text-[10px]">Root Principal</span>
                <span className="font-semibold text-[#0b1c30] text-[12px]">Vault #492 (You)</span>
                <span className="text-[#45464d] block">Signed: WebAuthn SecP256r1</span>
              </div>
              <div className="relative">
                <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-[#0051d5] border-2 border-[#ffffff]"></span>
                <span className="text-[#76777d] block text-[10px]">Mandate Authority</span>
                <span className="font-semibold text-[#0b1c30] text-[12px]">Shopping Agent</span>
                <span className="text-[#45464d] block">Token: tok_8819a (₹2,000 cap)</span>
              </div>
              <div className="relative">
                <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-[#009668] border-2 border-[#ffffff]"></span>
                <span className="text-[#76777d] block text-[10px]">Execution Pipe</span>
                <span className="font-semibold text-[#0b1c30] text-[12px]">Payment Agent</span>
                <span className="text-[#45464d] block">Sub-token: sub_0912f (₹820)</span>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">Execution Proof</h2>
              <span className="material-symbols-outlined text-[#009668] text-[20px]">lock</span>
            </div>
            <div className="p-3 rounded-lg bg-[#eff4ff] space-y-2 font-mono text-[11px] text-[#45464d] border border-[#c6c6cd]/30">
              <div>
                <span className="text-[#76777d] block text-[10px]">Merkle Leaf Digest:</span>
                <span className="text-[#0b1c30] break-all">0x8a91c49b402851a7e930129ef4021980018a1</span>
              </div>
              <div className="pt-2 border-t border-[#c6c6cd]/30 flex justify-between">
                <span className="text-[#76777d]">AWS Nitro PCR0:</span>
                <span className="text-[#009668] font-semibold">MATCH (Enclave)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#76777d]">ZK Proof System:</span>
                <span className="text-[#0b1c30]">Groth16 / BN254</span>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <button onClick={() => setProofOpen(true)} className="w-full py-2 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center gap-1.5 shadow-sm">
                <span className="material-symbols-outlined text-[16px]">visibility</span>
                <span>View Full Attestation</span>
              </button>
              <button onClick={handleDownload} disabled={downloading} className="w-full py-2 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-[#c6c6cd]/30">
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>{downloading ? 'Preparing Archive...' : 'Download Evidence Archive'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <ProofModal isOpen={proofOpen} onClose={() => setProofOpen(false)} txId="tx_901923" agent="Shopping Agent" merchant="ABC Supermarket" amount="₹820.00" status="ALLOWED" />
    </div>
  );
};
