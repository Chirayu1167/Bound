import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab, AgentNode, ApprovalItem, DelegationItem, MandateItem, MockPaymentItem, TaskItem, TransactionRecord } from './types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { WalletView } from './views/WalletView';
import { AgentsView } from './views/AgentsView';
import { AppsView } from './views/AppsView';
import { OrdersView } from './views/OrdersView';
import { ActivityView } from './views/ActivityView';
import { AuditView } from './views/AuditView';
import { PreferencesView } from './views/PreferencesView';
import { TransactionDetailModal } from './components/TransactionDetailModal';
import { CreateMandateModal, type MandateInitialValues } from './components/CreateMandateModal';
import { RegisterAgentModal } from './components/RegisterAgentModal';
import { CreateDelegationModal } from './components/CreateDelegationModal';
import { EditLimitModal } from './components/EditLimitModal';
import { SetupDomainDialog, type SetupDomainValues } from './components/SetupDomainDialog';
import type { TaskCheckInput } from './components/TaskCard';
import { DOMAINS, type DomainId } from './domains';
import * as api from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('wallet');
  const [agents, setAgents] = useState<AgentNode[]>([]);
  const [mandates, setMandates] = useState<MandateItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [delegations, setDelegations] = useState<DelegationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendLive, setBackendLive] = useState<boolean | null>(null);

  const [isCreateMandateOpen, setIsCreateMandateOpen] = useState(false);
  const [isCreateDelegationOpen, setIsCreateDelegationOpen] = useState(false);
  const [isRegisterAgentOpen, setIsRegisterAgentOpen] = useState(false);
  const [editLimitTarget, setEditLimitTarget] = useState<MandateItem | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [payments, setPayments] = useState<MockPaymentItem[]>([]);
  const [wallet, setWallet] = useState<api.WalletInfo | null>(null);
  const [walletTxns, setWalletTxns] = useState<api.WalletTx[]>([]);
  const [askPreset, setAskPreset] = useState<{ text: string; nonce: number } | null>(null);
  // Explicit domain setup: creating authority always needs user confirmation.
  const [setupDomainId, setSetupDomainId] = useState<DomainId | null>(null);
  const [mandateInitial, setMandateInitial] = useState<MandateInitialValues | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  const refreshWallet = useCallback(async () => {
    try {
      const [w, txns] = await Promise.all([api.getWallet(), api.getWalletTransactions(50)]);
      setWallet(w);
      setWalletTxns(txns);
    } catch (e) {
      console.error('[App] wallet refresh failed', e);
    }
  }, []);

  const refreshData = useCallback(async (): Promise<boolean> => {
    try {
      const [a, m, t, d, tk, ap, pay] = await Promise.all([
        api.getAgents(),
        api.getMandates(),
        api.getTransactions(),
        api.getDelegations(),
        api.getTasks().catch(() => [] as TaskItem[]),
        api.getApprovals().catch(() => [] as ApprovalItem[]),
        api.getMockPayments().catch(() => [] as MockPaymentItem[]),
      ]);
      setAgents(a);
      setMandates(m);
      setTransactions(t);
      setDelegations(d);
      setTasks(tk);
      setApprovals(ap);
      setPayments(pay);
      // Wallet is backend-owned state too, but never blocks the rest.
      await refreshWallet();
      // Core live endpoints succeeded, so the backend is demonstrably reachable.
      // This corrects a stale Offline latch from an earlier cold-start health probe.
      setBackendLive(true);
      return true;
    } catch (e) {
      console.error('[App] refresh failed', e);
      showToast('Could not load data from the backend.');
      return false;
    }
  }, [refreshWallet]);

  // One-time approval tokens live in localStorage (per browser session).
  // The backend stores only hashes and returns each token exactly once.
  const tokenStoreKey = 'bound.approval_tokens';
  const readTokens = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(tokenStoreKey) || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  };
  const saveToken = (approvalId: string, token: string) => {
    try {
      const all = readTokens();
      all[approvalId] = token;
      localStorage.setItem(tokenStoreKey, JSON.stringify(all));
    } catch {
      /* storage unavailable — approval stays usable only in memory */
    }
  };
  const takeToken = (approvalId: string): string | null => {
    const token = readTokens()[approvalId] || null;
    if (token) {
      try {
        const all = readTokens();
        delete all[approvalId];
        localStorage.setItem(tokenStoreKey, JSON.stringify(all));
      } catch {
        /* ignore */
      }
    }
    return token;
  };

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    (async () => {
      setLoading(true);
      // Run health + data in parallel: on Render the backend cold-starts, so a
      // sequential single-shot health probe can fail (503) while the later data
      // fetch succeeds after wake-up. Deriving Online from either success avoids
      // latching a false Offline when real data is on screen.
      const [health, dataOk] = await Promise.all([
        api.healthCheck().catch(() => ({ ok: false, mode: 'mock' as const })),
        refreshData(),
      ]);
      if (!mounted) return;
      const healthOk = health.ok && health.mode === 'live';
      setBackendLive(dataOk || healthOk);
      setLoading(false);
      // If still offline (backend was waking), re-probe until it answers.
      // Stops on first success (which also reloads data) or after 10 tries.
      if (!dataOk && !healthOk) {
        let attempts = 0;
        interval = setInterval(async () => {
          attempts += 1;
          const retry = await api.healthCheck().catch(() => ({ ok: false, mode: 'mock' as const }));
          const live = retry.ok && retry.mode === 'live';
          if (!mounted) {
            if (interval) clearInterval(interval);
            return;
          }
          if (live) {
            setBackendLive(true);
            if (interval) clearInterval(interval);
            await refreshData();
          } else if (attempts >= 10) {
            if (interval) clearInterval(interval);
          }
        }, 10000);
      }
    })();
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [refreshData]);

  const handleCreateMandate = async (payload: { agent_id: string; purpose: string; max_amount: number; merchant_category: string; expires_at?: string | null }) => {
    try {
      await api.createMandate(payload);
      showToast('Spending rule created.');
      await refreshData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not create rule: ${e.message}` : 'Could not create rule.');
      throw e;
    }
  };

  const handleRegisterAgent = async (payload: { name: string; description?: string }) => {
    try {
      await api.createAgent(payload);
      showToast('Agent created.');
      await refreshData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not create agent: ${e.message}` : 'Could not create agent.');
      throw e;
    }
  };

  const handleCreateDelegation = async (payload: { parent_agent_id: string; child_agent_id: string; parent_mandate_id: string; delegated_amount_limit: number; purpose: string; merchant_category: string; expires_at?: string | null }) => {
    try {
      await api.createDelegation(payload);
      showToast('Delegation created.');
      await refreshData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not create delegation: ${e.message}` : 'Could not create delegation.');
      throw e;
    }
  };

  const handleSaveLimit = async (id: string, newCap: number) => {
    try {
      await api.updateMandateCap(id, newCap);
      await refreshData();
      showToast('Limit updated.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not update limit: ${e.message}` : 'Could not update limit.');
      throw e;
    }
  };

  const handleToggleMandate = async (id: string) => {
    const target = mandates.find((m) => m.id === id);
    if (!target) return;
    const nextStatus = target.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE';
    try {
      await api.updateMandateStatus(id, nextStatus);
      await refreshData();
      showToast(nextStatus === 'REVOKED' ? 'Rule revoked.' : 'Rule re-activated.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not update rule: ${e.message}` : 'Could not update rule.');
      throw e;
    }
  };

  const handleRevokeAgent = async (agentId: string) => {
    const target = agents.find((a) => a.id === agentId);
    if (!target) return;
    const nextStatus = target.status === 'REVOKED' ? 'ACTIVE' : 'REVOKED';
    try {
      await api.updateAgentStatus(agentId, nextStatus);
      await refreshData();
      showToast(nextStatus === 'REVOKED' ? `${target.name} revoked.` : `${target.name} restored.`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not update agent: ${e.message}` : 'Could not update agent.');
      throw e;
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    try {
      await api.updateDelegationStatus(id, 'REVOKED');
      await refreshData();
      showToast('Delegation revoked.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not revoke delegation: ${e.message}` : 'Could not revoke delegation.');
      throw e;
    }
  };

  // Home task → real backend task. The decision, risk, approval token and
  // provenance all come from POST /tasks/authorize; the UI only displays.
  //
  // Semantic bridge (why "pizza" works under a "Groceries" rule): the intent
  // layer (Groq first, deterministic fallback) decides only the DOMAIN —
  // pizza/dinner/groceries are all food. When that domain agrees with the
  // chosen agent's backend domain, the request is sent in the mandate's own
  // scope wording, so word-matching can't false-negative a legitimate
  // request (₹400 pizza under a ₹1,000 food rule approves). When the domains
  // DISAGREE (headphones via Food Agent), the user's raw words go through
  // untouched, so the engine honestly returns NEEDS_REVIEW. Amount, caps,
  // status, delegation, risk and approval stay 100% backend-enforced —
  // Groq/the bridge can never authorize money.
  const handleCheckTask = async (input: TaskCheckInput) => {
    const mandate = mandates.find((m) => m.id === input.draft.mandateId) || null;
    const agent = mandate ? agents.find((a) => a.id === mandate.agent_id) || null : null;
    const domainAgrees =
      !!mandate && !!agent && input.draft.domainId.toUpperCase() === agent.domain;
    const res = await api.authorizeTask({
      domain_agent_id: input.draft.agentId || '',
      purpose: domainAgrees && mandate ? mandate.purpose : input.purpose,
      requested_amount: input.budget,
      category: mandate?.merchant_category || 'General',
      merchant: input.merchant,
    });
    if (res.approval && res.approval_token) {
      saveToken(res.approval.id, res.approval_token);
    }
    await refreshData();
    showToast(res.task.status === 'APPROVED' ? 'Approved.' : 'Needs review — see why below.');
    return res;
  };

  const handleApprove = async (approval: ApprovalItem) => {
    const token = readTokens()[approval.id] || null;
    if (!token) {
      showToast('Approval token unavailable — it was issued in another session.');
      throw new Error('Approval token unavailable — it was issued in another session.');
    }
    try {
      await api.resolveApproval(approval.id, token, 'approve');
      takeToken(approval.id);
      await refreshData();
      showToast('Approved once — your rule is unchanged.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not approve: ${e.message}` : 'Could not approve.');
      throw e;
    }
  };

  const handleDeny = async (approval: ApprovalItem) => {
    const token = readTokens()[approval.id] || null;
    if (!token) {
      showToast('Approval token unavailable — it was issued in another session.');
      throw new Error('Approval token unavailable — it was issued in another session.');
    }
    try {
      await api.resolveApproval(approval.id, token, 'deny');
      takeToken(approval.id);
      await refreshData();
      showToast('Denied.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not deny: ${e.message}` : 'Could not deny.');
      throw e;
    }
  };

  const handleCancelTask = async (task: TaskItem) => {
    try {
      await api.cancelTask(task.id);
      await refreshData();
      showToast('Task cancelled.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not cancel: ${e.message}` : 'Could not cancel.');
      throw e;
    }
  };

  const handleTopup = async (amount: number) => {
    try {
      await api.topupWallet(amount);
      await refreshWallet();
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Top-up failed: ${e.message}` : 'Top-up failed.');
      throw e;
    }
  };

  // Demo shortcuts (Settings) fill the Wallet ask bar and take you there.
  const handleFillAsk = (text: string) => {
    setAskPreset({ text, nonce: Date.now() });
    setActiveTab('wallet');
  };

  // Demo payment: create + execute back-to-back. The backend gates both
  // steps on task APPROVED + fresh + agent ACTIVE, validates the final
  // charge against the task ceiling, and debits the wallet — UI displays.
  const handlePayTask = async (task: TaskItem, method: string, note: string, actual: number, item: string | null) => {
    try {
      const created = await api.createMockPayment(task.id, method, note);
      const result = await api.executeMockPayment(created.id, false, actual, item);
      await refreshData();
      showToast(result.status === 'SUCCEEDED' ? 'Payment successful (demo).' : 'Payment failed (demo).');
      return result;
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Payment failed: ${e.message}` : 'Payment failed.');
      throw e;
    }
  };

  const handleRetryPayment = async (payment: MockPaymentItem, actual: number | null, item: string | null) => {
    try {
      const result = await api.executeMockPayment(payment.id, false, actual, item);
      await refreshData();
      showToast(result.status === 'SUCCEEDED' ? 'Payment successful (demo).' : 'Payment failed (demo).');
      return result;
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Retry failed: ${e.message}` : 'Retry failed.');
      throw e;
    }
  };

  // Demo 5 — replay protection: re-executing a SUCCEEDED payment must 409.
  // Returns the backend's rejection message for display; never masks errors.
  const handleVerifyReplay = async (payment: MockPaymentItem): Promise<string> => {
    try {
      await api.executeMockPayment(payment.id);
      await refreshData();
      return 'Payment executed again — this should not happen; please report it.';
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'Replay rejected by the backend.';
    }
  };

  // Quick-create for the request flow: when the user asks for a domain with
  // no agent yet ("You don't have a Food Agent yet. Create one?"), one click
  // builds the agent + its standing rule from the domain's suggested defaults
  // (user can edit everything later in Agents). The caller re-runs the saved
  // request text afterwards, so the user never retypes.
  const handleQuickCreateAgent = async (domainId: DomainId) => {
    const domain = DOMAINS.find((d) => d.id === domainId);
    if (!domain) throw new Error('Unknown domain.');
    const created = await api.createAgent({
      name: domain.suggestedAgentName,
      description: `${domain.suggestedPurpose} — managed via Bound`,
      domain: domainId.toUpperCase(),
    });
    await api.createMandate({
      agent_id: created.id,
      purpose: domain.suggestedPurpose,
      max_amount: domain.suggestedCap,
      merchant_category: domain.categories[0],
    });
    await refreshData();
    showToast(`${created.name} created (₹${domain.suggestedCap.toLocaleString()} per ${domain.unitWord}). Continue your request below.`);
  };
  // Step 1 of explicit domain setup: create the agent (confirmed in dialog,
  // including its backend domain and the category the rule will cover).
  // Step 2 opens the normal rule form prefilled — the rule is a separate
  // explicit confirmation, so no authority is ever granted silently.
  const handleConfirmSetupDomain = async (values: SetupDomainValues) => {
    if (!setupDomainId) return;
    const domain = DOMAINS.find((d) => d.id === setupDomainId);
    try {
      const created = await api.createAgent({
        name: values.agentName,
        description: `${values.purpose} — managed via Bound`,
        domain: setupDomainId.toUpperCase(),
      });
      await refreshData();
      showToast(`Agent “${created.name}” created. Now confirm its spending rule.`);
      setSetupDomainId(null);
      setMandateInitial({
        agentId: created.id,
        purpose: values.purpose,
        cap: values.cap,
        category: domain && domain.categories.includes(values.category) ? values.category : undefined,
      });
      setIsCreateMandateOpen(true);
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Could not create agent: ${e.message}` : 'Could not create agent.');
      throw e;
    }
  };

  const handleAuthorize = async (payload: { agent_id: string; amount: number; merchant: string; merchant_category: string; purpose: string }) => {
    try {
      const res = await api.authorizePayment(payload);
      await refreshData();
      showToast(res.decision === 'ALLOW' ? `Approved — ${res.transaction_id}` : `Needs review — ${res.transaction_id}`);
      return res;
    } catch (e: unknown) {
      showToast(e instanceof Error ? `Payment check failed: ${e.message}` : 'Payment check failed.');
      throw e;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f7f8fb] text-[#0b1c30] gap-3">
        <div className="w-7 h-7 border-[3px] border-[#e2e3e8] border-t-[#0b1c30] rounded-full animate-spin" />
        <p className="text-[13px] text-[#5a5c63]">Loading Bound…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f8fb] text-[#0b1c30]">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-[#0b1c30] text-white shadow-xl text-[13px] max-w-[90vw]">
          <span>{toastMessage}</span>
        </div>
      )}

      {backendLive === false && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-[#fdecea] border border-[#e8c4c0] text-[#93000a] text-[12px]">
          Backend offline — data may be stale
        </div>
      )}

      <Header activeTab={activeTab} onTabChange={setActiveTab} backendLive={backendLive} />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-12">
        {activeTab === 'wallet' && (
          <WalletView
            agents={agents}
            mandates={mandates}
            transactions={transactions}
            tasks={tasks}
            approvals={approvals}
            payments={payments}
            backendLive={backendLive}
            wallet={wallet}
            walletTxns={walletTxns}
            askPreset={askPreset}
            onNavigate={setActiveTab}
            onSelectTransaction={setSelectedTx}
            onCheckTask={handleCheckTask}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onCancelTask={handleCancelTask}
            onPayTask={handlePayTask}
            onRetryPayment={handleRetryPayment}
            onVerifyReplay={handleVerifyReplay}
            onRevokeAgent={handleRevokeAgent}
            onSetupDomain={setSetupDomainId}
            notify={showToast}
            onTopup={handleTopup}
            onQuickCreateAgent={handleQuickCreateAgent}
          />
        )}

        {activeTab === 'agents' && (
          <AgentsView
            agents={agents}
            mandates={mandates}
            delegations={delegations}
            transactions={transactions}
            onOpenRegister={() => setIsRegisterAgentOpen(true)}
            onRevokeAgent={handleRevokeAgent}
            onOpenCreateMandate={() => {
              setMandateInitial(null);
              setIsCreateMandateOpen(true);
            }}
            onAddRuleForAgent={(agentId) => {
              setMandateInitial({ agentId });
              setIsCreateMandateOpen(true);
            }}
            onEditLimit={(m) => setEditLimitTarget(m)}
            onToggleMandate={handleToggleMandate}
            onOpenCreateDelegation={() => setIsCreateDelegationOpen(true)}
            onRevokeDelegation={handleRevokeDelegation}
          />
        )}

        {activeTab === 'apps' && (
          <AppsView
            agents={agents}
            mandates={mandates}
            onCreateMandate={handleCreateMandate}
            onEditLimit={(m) => setEditLimitTarget(m)}
            onToggleMandate={handleToggleMandate}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersView
            tasks={tasks}
            payments={payments}
            transactions={transactions}
            agents={agents}
            approvals={approvals}
            walletTxns={walletTxns}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityView
            agents={agents}
            mandates={mandates}
            walletTxns={walletTxns}
            transactions={transactions}
            tasks={tasks}
            approvals={approvals}
            payments={payments}
            selected={selectedTx}
            onSelect={setSelectedTx}
            onAuthorize={handleAuthorize}
            onRefresh={async () => {
              await refreshData();
            }}
          />
        )}

        {activeTab === 'audit' && <AuditView transactions={transactions} />}

        {activeTab === 'preferences' && (
          <PreferencesView
            transactions={transactions}
            foodAgent={agents.find((a) => a.domain === 'FOOD' && a.status === 'ACTIVE' && !a.is_task_agent) || null}
            onRevokeAgent={handleRevokeAgent}
            onFillAsk={handleFillAsk}
          />
        )}
      </main>

      <Footer />

      {/* Shared transaction detail for Wallet (Activity has its own drawer) */}
      {activeTab === 'wallet' && selectedTx && (
        <TransactionDetailModal tx={selectedTx} agents={agents} mandates={mandates} onClose={() => setSelectedTx(null)} />
      )}

      {setupDomainId && (
        <SetupDomainDialog
          domain={DOMAINS.find((d) => d.id === setupDomainId) || DOMAINS[0]}
          existingNames={agents.map((a) => a.name)}
          onCancel={() => setSetupDomainId(null)}
          onConfirm={handleConfirmSetupDomain}
        />
      )}

      <CreateMandateModal
        isOpen={isCreateMandateOpen}
        onClose={() => {
          setIsCreateMandateOpen(false);
          setMandateInitial(null);
        }}
        agents={agents}
        onCreate={handleCreateMandate}
        initial={mandateInitial}
      />

      <RegisterAgentModal isOpen={isRegisterAgentOpen} onClose={() => setIsRegisterAgentOpen(false)} onCreate={handleRegisterAgent} />

      <CreateDelegationModal isOpen={isCreateDelegationOpen} onClose={() => setIsCreateDelegationOpen(false)} agents={agents} mandates={mandates} onCreate={handleCreateDelegation} />

      <EditLimitModal isOpen={!!editLimitTarget} onClose={() => setEditLimitTarget(null)} mandate={editLimitTarget} onSave={handleSaveLimit} />
    </div>
  );
}
