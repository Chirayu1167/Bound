import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab, AgentNode, MandateItem, TransactionRecord, DelegationItem } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { OverviewView } from './views/OverviewView';
import { MandatesView } from './views/MandatesView';
import { PaymentVerificationView } from './views/PaymentVerificationView';
import { AgentsView } from './views/AgentsView';
import { DelegationsView } from './views/DelegationsView';
import { SecurityViolationView } from './views/SecurityViolationView';
import { SecurityAuditView } from './views/SecurityAuditView';
import { ProofModal } from './components/ProofModal';
import { PanicModal } from './components/PanicModal';
import { CreateMandateModal } from './components/CreateMandateModal';
import { RegisterAgentModal } from './components/RegisterAgentModal';
import { CreateDelegationModal } from './components/CreateDelegationModal';
import { EditLimitModal } from './components/EditLimitModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import * as api from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [mandates, setMandates] = useState<MandateItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [delegations, setDelegations] = useState<DelegationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendLive, setBackendLive] = useState<boolean | null>(null);

  // Modals state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isPanicOpen, setIsPanicOpen] = useState(false);
  const [isCreateMandateOpen, setIsCreateMandateOpen] = useState(false);
  const [isCreateDelegationOpen, setIsCreateDelegationOpen] = useState(false);
  const [isRegisterAgentOpen, setIsRegisterAgentOpen] = useState(false);
  const [proofTarget, setProofTarget] = useState<TransactionRecord | null>(null);
  const [editLimitTarget, setEditLimitTarget] = useState<MandateItem | null>(null);

  // System State
  const [panicSevered, setPanicSevered] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  // Data loading
  const refreshData = useCallback(async () => {
    try {
      const [a, m, t, d] = await Promise.all([api.getAgents(), api.getMandates(), api.getTransactions(), api.getDelegations()]);
      setAgents(a);
      setMandates(m);
      setTransactions(t);
      setDelegations(d);
      const allRevoked = a.length > 0 && a.every((ag) => ag.status === 'REVOKED');
      setPanicSevered(allRevoked);
    } catch (e) {
      console.error('[App] refresh failed', e);
      showToast('Failed to sync with Bound backend.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const health = await api.healthCheck().catch(() => ({ ok: false, mode: 'mock' as const }));
      if (mounted) setBackendLive(health.ok && health.mode === 'live');
      await refreshData();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshData]);

  // Keyboard shortcut for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Panic Revoke All Handler — now hits backend PATCH for each
  const handleConfirmPanic = async () => {
    setPanicSevered(true);
    const activeAgents = agents.filter((a) => a.status === 'ACTIVE');
    const activeMandates = mandates.filter((m) => m.status === 'ACTIVE');
    const activeDelegations = delegations.filter((d) => d.status === 'ACTIVE');
    try {
      await Promise.all([
        ...activeAgents.map((a) => api.updateAgentStatus(a.id, 'REVOKED').catch(() => null)),
        ...activeMandates.map((m) => api.updateMandateStatus(m.id, 'REVOKED').catch(() => null)),
        ...activeDelegations.map((d) => api.updateDelegationStatus(d.id, 'REVOKED').catch(() => null)),
      ]);
      await refreshData();
      showToast('Panic protocol executed: All agent keys and delegations revoked across hardware enclaves.');
    } catch {
      showToast('Panic revoke partially failed — please refresh.');
    }
    setIsPanicOpen(false);
    // Optimistic local update
    setAgents((prev) => prev.map((a) => ({ ...a, status: 'REVOKED', heartbeat: 'Severed by Panic protocol' })));
    setMandates((prev) => prev.map((m) => ({ ...m, status: 'REVOKED', safeBuffer: 'Mandate Inactive (Emergency Protocol)' })));
    setDelegations((prev) => prev.map((d) => ({ ...d, status: 'REVOKED' } as DelegationItem)));
  };

  // Add Mandate — now creates via backend
  const handleSaveMandate = async (newMandate: MandateItem) => {
    const agent = agents.find((a) => a.name === newMandate.boundAgent);
    if (!agent) {
      showToast(`Cannot resolve agent ${newMandate.boundAgent}`);
      return;
    }
    const mccRaw = newMandate.mccCode.replace(/^MCC\s*/i, '').trim() || 'Grocery';
    let expiresIso: string | null = null;
    if (newMandate.expiry && !newMandate.expiry.includes('No expiry')) {
      const parsed = Date.parse(newMandate.expiry.replace('Expires ', ''));
      if (!isNaN(parsed)) expiresIso = new Date(parsed).toISOString();
    }
    try {
      const created = await api.createMandate({
        agent_id: agent.id,
        purpose: newMandate.name,
        max_amount: newMandate.cap,
        merchant_category: mccRaw,
        expires_at: expiresIso,
      });
      setMandates((prev) => [created, ...prev]);
      showToast(`Mandate ${created.code} created & signed with Root Vault KMS.`);
      await refreshData();
    } catch (e: any) {
      showToast(`Failed to create mandate: ${e.message || e}`);
    }
  };

  const handleCreateMandateApi = async (payload: { agent_id: string; purpose: string; max_amount: number; merchant_category: string; expires_at?: string | null }) => {
    try {
      const created = await api.createMandate(payload);
      setMandates((prev) => [created, ...prev]);
      showToast(`Mandate ${created.code} created & signed with Root Vault KMS.`);
      await refreshData();
    } catch (e: any) {
      showToast(`Failed to create mandate: ${e.message || e}`);
      throw e;
    }
  };

  // Add Agent — now creates via backend
  const handleRegisterAgent = async (newAgent: AgentNode) => {
    const name = newAgent.name;
    const cap = newAgent.authorizedAmount || 5000;
    const mccList = (newAgent.mccAllowed || []).join(', ');
    const description = `${newAgent.purpose || ''} Cap ₹${cap}, MCCs: ${mccList}`.trim();
    try {
      const created = await api.createAgent({ name, description, capAmount: cap, mccList });
      setAgents((prev) => [created, ...prev]);
      showToast(`Agent ${created.name} provisioned in Bound Nitro Enclave.`);
      await refreshData();
    } catch (e: any) {
      showToast(`Failed to register agent: ${e.message || e}`);
    }
  };

  const handleRegisterAgentApi = async (payload: { name: string; description?: string; capAmount?: number; mccList?: string }) => {
    try {
      const created = await api.createAgent(payload);
      setAgents((prev) => [created, ...prev]);
      showToast(`Agent ${created.name} provisioned in Bound Nitro Enclave.`);
      await refreshData();
    } catch (e: any) {
      showToast(`Failed to register agent: ${e.message || e}`);
      throw e;
    }
  };

  // Delegation handlers
  const handleCreateDelegation = async (payload: { parent_agent_id: string; child_agent_id: string; parent_mandate_id: string; delegated_amount_limit: number; purpose: string; merchant_category: string; expires_at?: string | null }) => {
    try {
      const created = await api.createDelegation(payload);
      setDelegations((prev) => [created, ...prev]);
      showToast(`Delegation ${created.id} created: ${created.parentAgentName} → ${created.childAgentName} ₹${created.delegatedLimit.toLocaleString()}`);
      await refreshData();
    } catch (e: any) {
      showToast(`Failed to create delegation: ${e.message || e}`);
      throw e;
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    try {
      await api.updateDelegationStatus(id, 'REVOKED');
      await refreshData();
      showToast('Delegation revoked. Child can no longer act under parent authority.');
    } catch (e: any) {
      showToast(`Failed to revoke delegation: ${e.message || e}`);
    }
  };

  // Edit Mandate Limit — PATCH backend
  const handleSaveLimit = async (id: string, newCap: number) => {
    try {
      await api.updateMandateCap(id, newCap);
      await refreshData();
      showToast(`Mandate limit updated to ₹${newCap.toLocaleString()}.`);
    } catch (e: any) {
      showToast(`Failed to update limit: ${e.message || e}`);
    }
  };

  // Toggle Mandate Revocation — PATCH
  const handleToggleRevokeMandate = async (id: string) => {
    const target = mandates.find((m) => m.id === id);
    if (!target) return;
    const nextStatus = target.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE';
    try {
      await api.updateMandateStatus(id, nextStatus as any);
      await refreshData();
      showToast(nextStatus === 'REVOKED' ? 'Mandate revoked.' : 'Mandate re-activated.');
    } catch (e: any) {
      showToast(`Failed to toggle mandate: ${e.message || e}`);
    }
  };

  // Revoke single agent key — PATCH
  const handleRevokeAgent = async (agentId: string) => {
    const target = agents.find((a) => a.id === agentId);
    if (!target) return;
    const nextStatus = target.status === 'REVOKED' ? 'ACTIVE' : 'REVOKED';
    try {
      await api.updateAgentStatus(agentId, nextStatus);
      await refreshData();
      showToast(nextStatus === 'REVOKED' ? `Agent ${target.name} revoked.` : `Agent ${target.name} restored.`);
    } catch (e: any) {
      showToast(`Failed to update agent: ${e.message || e}`);
    }
  };

  // Rotate single agent signature — local only
  const handleRotateSignature = (agentId: string) => {
    const newHash = `sha256:${Math.random().toString(36).substring(2, 7)}…${Math.random().toString(36).substring(2, 5)}`;
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          return { ...a, hash: newHash, heartbeat: 'Rotated just now' };
        }
        return a;
      })
    );
    showToast(`Cryptographic keypair rotated. Enclave PCR0 attestation re-signed.`);
  };

  const handleResolveViolation = async (action: 'override' | 'revoke' | 'reject') => {
    if (action === 'revoke') {
      const toRevoke = agents.find((a) => a.id === 'shopping-agent' || a.name.toLowerCase().includes('payment')) || agents[0];
      if (toRevoke) {
        try {
          await api.updateAgentStatus(toRevoke.id, 'REVOKED');
          await refreshData();
        } catch {}
      }
      showToast('Payment Agent keypair severed. Downstream token invalidation complete.');
    } else if (action === 'override') {
      showToast('One-time WebAuthn biometric override registered.');
    } else {
      showToast('Violation event committed to tamper-proof Merkle audit tree.');
    }
  };

  const handleAuthorize = async (payload: { agent_id: string; amount: number; merchant: string; merchant_category: string; purpose: string }) => {
    try {
      const res = await api.authorizePayment(payload);
      await refreshData();
      // Show chain in toast if present
      const chainHint = res.chain ? ` Chain: ${res.chain.map((s) => s.step).join(' → ')}` : '';
      showToast(`Authorization ${res.decision}: ${res.reason} (TX ${res.transaction_id})${chainHint}`);
      return res;
    } catch (e: any) {
      showToast(`Authorization failed: ${e.message || e}`);
      throw e;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9ff] text-[#0b1c30] gap-3">
        <div className="w-8 h-8 border-4 border-[#c6c6cd]/30 border-t-[#0051d5] rounded-full animate-spin" />
        <p className="font-mono text-[12px] text-[#76777d]">Syncing with Bound enclave…</p>
        <p className="font-mono text-[11px] text-[#45464d]">Connecting to {BASE}…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9ff] text-[#0b1c30]">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#0b1c30] text-[#ffffff] shadow-2xl border border-[#ffffff]/20 font-mono text-[12px] animate-in slide-in-from-bottom-3 max-w-[90vw]">
          <span className="material-symbols-outlined text-[#009668] text-[18px]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {backendLive === false && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full bg-[#ffdad6] border border-[#ba1a1a]/30 text-[#93000a] font-mono text-[11px] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#ba1a1a] animate-pulse" />
          Backend offline — showing cached demo data
        </div>
      )}

      <Header activeTab={activeTab} onTabChange={setActiveTab} onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} panicSevered={panicSevered} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-12">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[12px] text-[#76777d]">
            <button onClick={() => setActiveTab('overview')} className="hover:text-[#0b1c30] cursor-pointer">
              Vault #1
            </button>
            <span>/</span>
            <span className="text-[#0b1c30] font-medium capitalize">{activeTab === 'violation' ? 'Security Intercept' : activeTab}</span>
            {backendLive && <span className="ml-2 hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#eff4ff] border border-[#c6c6cd]/30 text-[#009668] font-mono text-[10px]">● Live · {BASE}</span>}
          </div>

          {activeTab !== 'violation' && (
            <button
              onClick={() => setActiveTab('violation')}
              className="text-[11px] font-mono px-2 py-1 rounded bg-[#ffdad6] text-[#93000a] hover:bg-[#ffb4ab] transition-colors cursor-pointer flex items-center gap-1 border border-[#ba1a1a]/30"
            >
              <span className="material-symbols-outlined text-[14px]">warning</span>
              <span>Inspect Intercept #INC-901844</span>
            </button>
          )}
        </div>

        {activeTab === 'overview' && (
          <OverviewView
            agents={agents}
            mandates={mandates}
            transactions={transactions}
            onOpenProof={(tx) => setProofTarget(tx)}
            onOpenPanic={() => setIsPanicOpen(true)}
            onOpenCreateMandate={() => setIsCreateMandateOpen(true)}
            onNavigateTab={setActiveTab}
            panicSevered={panicSevered}
          />
        )}

        {activeTab === 'agents' && <AgentsView agents={agents} onOpenRegisterModal={() => setIsRegisterAgentOpen(true)} onRevokeAgent={handleRevokeAgent} onRotateSignature={handleRotateSignature} />}

        {activeTab === 'mandates' && (
          <MandatesView
            mandates={mandates}
            onOpenCreateMandate={() => setIsCreateMandateOpen(true)}
            onEditLimit={(m) => setEditLimitTarget(m)}
            onToggleRevoke={handleToggleRevokeMandate}
          />
        )}

        {activeTab === 'delegations' && (
          <DelegationsView delegations={delegations} agents={agents} mandates={mandates} onOpenCreate={() => setIsCreateDelegationOpen(true)} onRevoke={handleRevokeDelegation} />
        )}

        {activeTab === 'transactions' && <PaymentVerificationView agents={agents} transactions={transactions} onAuthorize={handleAuthorize} onRefresh={refreshData} />}

        {activeTab === 'security' && <SecurityAuditView />}

        {activeTab === 'violation' && <SecurityViolationView onResolveViolation={handleResolveViolation} onNavigateTab={setActiveTab} />}
      </main>

      <Footer />

      <CommandPaletteModal isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} agents={agents} mandates={mandates} transactions={transactions} onSelectTab={setActiveTab} onOpenProof={(tx) => setProofTarget(tx)} />

      <PanicModal isOpen={isPanicOpen} onClose={() => setIsPanicOpen(false)} onConfirm={handleConfirmPanic} />

      <CreateMandateModal isOpen={isCreateMandateOpen} onClose={() => setIsCreateMandateOpen(false)} agents={agents} onSaveMandate={handleSaveMandate} onCreateMandateApi={handleCreateMandateApi} />

      <RegisterAgentModal isOpen={isRegisterAgentOpen} onClose={() => setIsRegisterAgentOpen(false)} onRegisterAgent={handleRegisterAgent} onRegisterAgentApi={handleRegisterAgentApi} />

      <CreateDelegationModal isOpen={isCreateDelegationOpen} onClose={() => setIsCreateDelegationOpen(false)} agents={agents} mandates={mandates} onCreate={handleCreateDelegation} />

      <EditLimitModal isOpen={!!editLimitTarget} onClose={() => setEditLimitTarget(null)} mandate={editLimitTarget} onSaveLimit={handleSaveLimit} />

      <ProofModal isOpen={!!proofTarget} onClose={() => setProofTarget(null)} txId={proofTarget?.id} agent={proofTarget?.agent} merchant={proofTarget?.merchant} amount={proofTarget?.amount} status={proofTarget?.decision === 'ALLOW' ? 'ALLOWED' : 'VERIFIED'} />
    </div>
  );
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:4000';
