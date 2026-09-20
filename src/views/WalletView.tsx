import React, { useMemo, useState } from 'react';
import { ActiveTab, AgentNode, ApprovalItem, MandateItem, MockPaymentItem, TaskItem, TransactionRecord } from '../types';
import { DOMAINS, resolveDomainAgent, ruleSummary, type DomainDef, type DomainId } from '../domains';
import { DOMAIN_DEFAULT_PURPOSE, parseRequest, type ParsedIntent } from '../intent';
import { createTaskDraft, type TaskDraft } from '../tasks';
import { usualMerchants, usualSpendRange, formatUsualSpend } from '../preferences';
import {
  detectReference,
  emptySession,
  formatINR,
  historyForDomain,
  medianApproved,
  type SessionContext,
} from '../context';
import { ConfirmDialog, EmptyState } from '../components/ui';
import { AskBar } from '../components/AskBar';
import { TaskCard, type TaskCheckInput } from '../components/TaskCard';
import { TaskResultCard } from '../components/TaskResultCard';
import { ApprovalCard } from '../components/ApprovalCard';
import { PaymentScreen } from '../components/PaymentScreen';
import { ActivityFeed } from '../components/ActivityFeed';
import { DEMO_APPS, connectionsForApps } from '../apps';
import { executeMockPayment, interpretRequest, type WalletInfo, type WalletTx } from '../services/api';
import { FlowSteps, type FlowStage } from '../components/FlowSteps';
import { ConversationCard, type ConversationState } from '../components/ConversationCard';
import type { TaskAuthorizeResult } from '../services/api';

interface WalletViewProps {
  agents: AgentNode[];
  mandates: MandateItem[];
  transactions: TransactionRecord[];
  tasks: TaskItem[];
  approvals: ApprovalItem[];
  payments: MockPaymentItem[];
  backendLive: boolean | null;
  wallet: WalletInfo | null;
  walletTxns: WalletTx[];
  askPreset: { text: string; nonce: number } | null;
  onNavigate: (tab: ActiveTab) => void;
  onSelectTransaction: (tx: TransactionRecord) => void;
  onCheckTask: (input: TaskCheckInput) => Promise<TaskAuthorizeResult>;
  onApprove: (approval: ApprovalItem) => Promise<void>;
  onDeny: (approval: ApprovalItem) => Promise<void>;
  onCancelTask: (task: TaskItem) => Promise<void>;
  onPayTask: (task: TaskItem, method: string, note: string) => Promise<MockPaymentItem>;
  onRetryPayment: (payment: MockPaymentItem) => Promise<MockPaymentItem>;
  onRevokeAgent: (agentId: string) => Promise<void>;
  onSetupDomain: (domainId: DomainId) => void;
  notify: (msg: string) => void;
  onVerifyReplay?: (payment: MockPaymentItem) => Promise<string>;
  onTopup: (amount: number) => Promise<void>;
}

interface DraftState {
  draft: TaskDraft;
  domainId: DomainId;
  notes: string[];
  /** Remount key so accepted proposals start the form fresh. */
  nonce: number;
  /** Context-suggested merchant. Applied once, stays editable. */
  merchantSeed: string | null;
}

function domainDefForAgent(agent: AgentNode | undefined): DomainDef | null {
  if (!agent || agent.is_task_agent) return null;
  return DOMAINS.find((d) => d.id.toUpperCase() === agent.domain) || null;
}

function isLiveTask(t: TaskItem, now: number): boolean {
  if (t.status === 'CANCELLED' || t.status === 'EXPIRED' || t.status === 'COMPLETED') return false;
  const exp = new Date(t.expires_at).getTime();
  if (Number.isFinite(exp) && exp < now) return false;
  return true;
}

export const WalletView: React.FC<WalletViewProps> = ({
  agents,
  mandates,
  transactions,
  tasks,
  approvals,
  payments,
  backendLive,
  wallet,
  walletTxns,
  askPreset,
  onNavigate,
  onSelectTransaction,
  onCheckTask,
  onApprove,
  onDeny,
  onCancelTask,
  onPayTask,
  onRetryPayment,
  onRevokeAgent,
  onSetupDomain,
  notify,
  onVerifyReplay,
  onTopup,
}) => {
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [notUnderstood, setNotUnderstood] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ task: TaskItem; approval: ApprovalItem | null } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<TaskItem | null>(null);
  // Payment screen state: which APPROVED task is being paid + its payment row.
  const [payingTaskId, setPayingTaskId] = useState<string | null>(null);
  const [payment, setPayment] = useState<MockPaymentItem | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState('5000');
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);
  // Phase 5: in-memory session context only. Nothing here is persisted and
  // nothing here authorizes — it only pre-fills what the user then confirms.
  const [session, setSession] = useState<SessionContext>(emptySession);
  const [conversation, setConversation] = useState<ConversationState | null>(null);
  const [pendingRefAsk, setPendingRefAsk] = useState<string | null>(null);

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopupError(null);
    const amount = parseFloat(topupAmount);
    if (!amount || amount <= 0) {
      setTopupError('Enter an amount greater than zero.');
      return;
    }
    setTopupBusy(true);
    try {
      await onTopup(amount);
      setTopupOpen(false);
      notify(`Added ₹${amount.toLocaleString()} in demo funds.`);
    } catch (err: unknown) {
      setTopupError(err instanceof Error ? err.message : 'Top-up failed.');
    } finally {
      setTopupBusy(false);
    }
  };

  const touchSession = (patch: Partial<SessionContext>) => {
    setSession((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));
  };

  const mandateCapFor = (agentId: string | null): number | null => {
    if (!agentId) return null;
    const m = mandates
      .filter((x) => x.agent_id === agentId && x.status === 'ACTIVE')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    return m ? m.max_amount : null;
  };

  const now = Date.now();
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const resolutions = useMemo(
    () => new Map(DOMAINS.map((d) => [d.id, resolveDomainAgent(d.id, agents, mandates)] as const)),
    [agents, mandates]
  );

  const approvalByTask = useMemo(() => new Map(approvals.map((a) => [a.task_id, a])), [approvals]);
  const paymentByTask = useMemo(() => {
    const m = new Map<string, MockPaymentItem>();
    for (const p of payments) m.set(p.task_id, p);
    return m;
  }, [payments]);
  const liveTasks = useMemo(() => tasks.filter((t) => isLiveTask(t, now)).slice(0, 5), [tasks, now]);
  const reviewTasks = useMemo(
    () => liveTasks.filter((t) => t.status === 'NEEDS_REVIEW' && approvalByTask.get(t.id)?.status === 'PENDING'),
    [liveTasks, approvalByTask]
  );
  const otherTasks = useMemo(
    () => liveTasks.filter((t) => t.status === 'PENDING' || t.status === 'APPROVED'),
    [liveTasks]
  );
  const taskTxIds = useMemo(() => new Set(tasks.map((t) => t.transaction_id).filter(Boolean)), [tasks]);
  const orphanReview = useMemo(
    () => transactions.filter((t) => t.decision !== 'ALLOW' && !taskTxIds.has(t.id)).slice(0, 3),
    [transactions, taskTxIds]
  );

  const makeDraftState = (
    domainId: DomainId,
    purpose: string,
    budget: number | null,
    merchantSeed: string | null,
    notes: string[]
  ): DraftState => {
    const res = resolveDomainAgent(domainId, agents, mandates);
    return {
      draft: createTaskDraft(domainId, purpose, budget, res?.agent.id || null, res?.mandate.id || null),
      domainId,
      notes,
      nonce: Date.now(),
      merchantSeed,
    };
  };

  const handleAsk = async (text: string) => {
    setLastResult(null);
    setCheckError(null);
    setConversation(null);
    setPendingRefAsk(null);
    let intent = parseRequest(text);
    // Optional LLM assist: only when the deterministic parser is uncertain,
    // and only to pre-fill the draft. Any failure falls back silently.
    if ((intent.kind === 'unknown' || !intent.domainId) && text.trim()) {
      try {
        const g = await interpretRequest(text);
        if (g.groq && (g.domain || g.purpose || g.budget !== null || g.merchant)) {
          const notes = [
            'Suggested by AI — confirm everything below before checking.',
            ...(g.explanation ? [`AI note: ${g.explanation}`] : []),
            ...(g.category ? [`Suggested category ${g.category} — the check itself uses your rule's category.`] : []),
          ];
          if (g.domain) {
            const d = g.domain as DomainId;
            setNotUnderstood(null);
            setDraftState({ ...makeDraftState(d, g.purpose || DOMAIN_DEFAULT_PURPOSE[d], g.budget, g.merchant, notes) });
            touchSession({ domainId: d, purpose: g.purpose ?? null, amount: g.budget, merchant: g.merchant });
            return;
          }
          intent = { ...intent, kind: 'request', purpose: g.purpose ?? intent.purpose, budget: g.budget ?? intent.budget, notes };
          if (g.merchant) touchSession({ merchant: g.merchant });
        }
      } catch {
        /* offline, no key, or timeout — deterministic path below */
      }
    }
    if (intent.kind === 'cancel') {
      setDraftState(null);
      setNotUnderstood(null);
      notify('Nothing pending — no order was placed.');
      return;
    }
    // References carry no parseable domain/budget of their own: resolve them
    // against the session first ("Same as usual" after a food request means
    // food), else ask which area. This must run before the unknown branch.
    const ref = detectReference(text, intent.budget != null);
    if (intent.kind === 'unknown' || !intent.domainId) {
      if (intent.kind === 'unknown' && ref === 'none') {
        setDraftState(null);
        setNotUnderstood('I didn\u2019t understand that. Try “Order me dinner under ₹800”.');
        return;
      }
      if (ref !== 'none' && session.domainId) {
        routeAsk(text, intent, null);
        return;
      }
      if (ref !== 'none') {
        setPendingRefAsk(text);
        setNotUnderstood(null);
        setConversation({ kind: 'need-domain', text });
        return;
      }
      const fallback: DomainId = 'food';
      setNotUnderstood(null);
      setDraftState({ ...makeDraftState(fallback, intent.purpose || 'Order', intent.budget, null, intent.notes) });
      touchSession({ domainId: fallback, purpose: intent.purpose ?? null });
      return;
    }
    routeAsk(text, intent, null);
  };

  /** Route a parsed request, optionally with a domain forced by disambiguation. */
  const routeAsk = (text: string, intent: ParsedIntent, forcedDomain: DomainId | null) => {
    const ref = detectReference(text, intent.budget != null);
    if (ref === 'spending-query') {
      const domainId = forcedDomain ?? intent.domainId ?? session.domainId;
      if (!domainId) {
        setPendingRefAsk(text);
        setConversation({ kind: 'need-domain', text });
        return;
      }
      answerSpending(domainId);
      touchSession({ domainId });
      return;
    }
    const budgetAffecting = ref === 'usual-budget' || ref === 'last-transaction' || ref === 'cheaper';
    if (intent.budget == null && budgetAffecting) {
      const domainId = forcedDomain ?? intent.domainId ?? session.domainId;
      if (!domainId) {
        setPendingRefAsk(text);
        setConversation({ kind: 'need-domain', text });
        return;
      }
      handleReference(intent, domainId, ref);
      touchSession({ domainId });
      return;
    }
    // Normal draft flow. Explicit values always win; a merchant may still be
    // borrowed from context when the text names none.
    const domainId = forcedDomain ?? intent.domainId ?? session.domainId;
    if (!domainId) return;
    const def = DOMAINS.find((d) => d.id === domainId);
    // Borrow a merchant only when the text names none: session first (most
    // recent interaction), else last historical merchant. Still editable,
    // still requires an explicit check click.
    let merchantSeed: string | null = null;
    if (ref === 'last-transaction' || ref === 'same-merchant') {
      const last = historyForDomain(transactions, def?.categories || []).last;
      merchantSeed =
        session.domainId === domainId && session.merchant
          ? session.merchant
          : last?.merchant || null;
    }
    setNotUnderstood(null);
    setDraftState({
      ...makeDraftState(domainId, intent.purpose || 'Order', intent.budget, merchantSeed, intent.notes),
    });
    const res = resolveDomainAgent(domainId, agents, mandates);
    touchSession({
      domainId,
      purpose: intent.purpose ?? null,
      amount: intent.budget,
      category: res?.mandate.merchant_category ?? null,
      agentId: res?.agent.id ?? null,
    });
  };

  /** Budget-affecting reference with no explicit amount: propose, never execute. */
  const handleReference = (
    intent: ParsedIntent,
    domainId: DomainId,
    ref: 'usual-budget' | 'last-transaction' | 'cheaper'
  ) => {
    const def = DOMAINS.find((d) => d.id === domainId);
    if (!def) return;
    setNotUnderstood(null);
    if (ref === 'usual-budget') {
      const usual = usualSpendRange(transactions, def.categories);
      if (!usual) {
        setConversation({
          kind: 'insufficient',
          domain: def,
          what: `I don't have enough history to determine your usual ${def.label.toLowerCase()} spend.`,
        });
        return;
      }
      const res = resolveDomainAgent(domainId, agents, mandates);
      setConversation({
        kind: 'proposal-usual',
        domain: def,
        usual,
        cap: res ? mandateCapFor(res.agent.id) : null,
      });
      return;
    }
    if (ref === 'last-transaction') {
      const last = historyForDomain(transactions, def.categories).last;
      if (!last) {
        setConversation({
          kind: 'insufficient',
          domain: def,
          what: `I couldn't find a previous ${def.label.toLowerCase()} payment to repeat.`,
        });
        return;
      }
      setConversation({ kind: 'proposal-last', domain: def, tx: last });
      return;
    }
    // cheaper
    const history = historyForDomain(transactions, def.categories);
    const usual = usualSpendRange(transactions, def.categories);
    const basis = usual?.low ?? medianApproved(history) ?? history.last?.rawAmount ?? null;
    if (!basis) {
      setConversation({
        kind: 'insufficient',
        domain: def,
        what: `I don't have enough history to suggest a cheaper ${def.label.toLowerCase()} amount.`,
      });
      return;
    }
    setConversation({
      kind: 'proposal-cheaper',
      domain: def,
      amount: basis,
      basis: usual ? 'the low end of your usual range' : 'your last payment',
    });
  };

  const answerSpending = (domainId: DomainId) => {
    const def = DOMAINS.find((d) => d.id === domainId) || null;
    const items = historyForDomain(transactions, def?.categories || []).approved.slice(0, 5);
    setNotUnderstood(null);
    setDraftState(null);
    setConversation({ kind: 'spending-answer', domain: def, items });
  };

  const pickDomainForPending = (d: DomainId) => {
    const text = pendingRefAsk;
    setPendingRefAsk(null);
    if (!text) return;
    routeAsk(text, parseRequest(text), d);
  };

  const acceptBudget = (amount: number) => {
    if (!conversation || (conversation.kind !== 'proposal-usual' && conversation.kind !== 'proposal-cheaper')) return;
    const def = conversation.domain;
    const purpose =
      session.domainId === def.id && session.purpose ? session.purpose : DOMAIN_DEFAULT_PURPOSE[def.id];
    setConversation(null);
    setDraftState({
      ...makeDraftState(def.id, purpose, amount, null, [
        `Confirmed ${formatINR(amount)} — you can still edit everything below before checking.`,
      ]),
    });
    touchSession({ domainId: def.id, purpose, amount });
  };

  const acceptLast = (tx: TransactionRecord) => {
    if (!conversation || conversation.kind !== 'proposal-last') return;
    const def = conversation.domain;
    setConversation(null);
    setDraftState({
      ...makeDraftState(def.id, tx.purpose, tx.rawAmount, tx.merchant, [
        'Using your last payment’s details — you can still edit everything below before checking.',
      ]),
    });
    touchSession({ domainId: def.id, purpose: tx.purpose, amount: tx.rawAmount, merchant: tx.merchant });
  };

  const enterManually = () => {
    if (!conversation || !('domain' in conversation) || !conversation.domain) {
      setConversation(null);
      return;
    }
    const def = conversation.domain;
    const purpose =
      session.domainId === def.id && session.purpose ? session.purpose : DOMAIN_DEFAULT_PURPOSE[def.id];
    setConversation(null);
    setDraftState({ ...makeDraftState(def.id, purpose, null, null, []) });
    touchSession({ domainId: def.id, purpose });
  };

  const handlePickDomain = (domainId: DomainId) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      const res = resolveDomainAgent(domainId, agents, mandates);
      return {
        ...prev,
        domainId,
        draft: { ...prev.draft, domainId, agentId: res?.agent.id || null, mandateId: res?.mandate.id || null },
      };
    });
  };

  const handleCheck = async (input: TaskCheckInput) => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await onCheckTask(input);
      setLastResult({ task: result.task, approval: result.approval });
      setDraftState(null);
      setConversation(null);
      touchSession({
        merchant: input.merchant,
        amount: input.budget,
        agentId: result.task.domain_agent_id,
        lastTaskStatus: result.task.status,
      });
    } catch (e: unknown) {
      setCheckError(e instanceof Error ? e.message : 'The check failed.');
    } finally {
      setChecking(false);
    }
  };

  const runAction = async (fn: () => Promise<void>, okMsg: string) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await fn();
      setLastResult(null);
      notify(okMsg);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'That didn\u2019t work.');
    } finally {
      setActionBusy(false);
    }
  };

  const ruleLineForTask = (task: TaskItem): string | null => {
    const agent = agentById.get(task.domain_agent_id);
    const def = domainDefForAgent(agent);
    if (!agent || !def) return null;
    const mandate = mandates
      .filter((m) => m.agent_id === agent.id && m.status === 'ACTIVE')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!mandate) return null;
    return `Your ${def.label} rule allows ${ruleSummary(mandate, def)}.`;
  };

  const usualLineForTask = (task: TaskItem): string | null => {
    const agent = agentById.get(task.domain_agent_id);
    const def = domainDefForAgent(agent);
    if (!def) return null;
    const usual = usualSpendRange(transactions, def.categories);
    if (!usual) return null;
    return `Your usual ${def.label.toLowerCase()} spend is ${formatUsualSpend(usual)}.`;
  };

  const ruleLineForTx = (tx: TransactionRecord): string | null => {
    const mandate = mandates.find((m) => m.id === tx.mandate_id);
    if (!mandate) return null;
    const agent = agentById.get(mandate.agent_id);
    const def = domainDefForAgent(agent);
    if (!def) return `Your rule allows up to ₹${mandate.max_amount.toLocaleString()}.`;
    return `Your ${def.label} rule allows ${ruleSummary(mandate, def)}.`;
  };

  const usualLineForTx = (tx: TransactionRecord): string | null => {
    const mandate = mandates.find((m) => m.id === tx.mandate_id);
    const agent = mandate ? agentById.get(mandate.agent_id) : agentById.get(tx.agent_id);
    const def = domainDefForAgent(agent);
    if (!def) return null;
    const usual = usualSpendRange(transactions, def.categories);
    if (!usual) return null;
    return `Your usual ${def.label.toLowerCase()} spend is ${formatUsualSpend(usual)}.`;
  };

  const draftAgent = draftState ? agentById.get(draftState.draft.agentId || '') || null : null;
  const draftMandate = draftState ? mandates.find((m) => m.id === draftState.draft.mandateId) || null : null;
  const draftDef = draftState ? DOMAINS.find((d) => d.id === draftState.domainId) : null;
  const merchantSuggestions = draftDef ? usualMerchants(transactions, draftDef.categories) : [];

  const openPayment = (task: TaskItem) => {
    setPayingTaskId(task.id);
    setPayment(paymentByTask.get(task.id) || null);
    setPayError(null);
  };

  const handlePay = async (task: TaskItem, method: string, note: string) => {
    setPayBusy(true);
    setPayError(null);
    try {
      const result = await onPayTask(task, method, note);
      setPayment(result);
      if (result.status === 'SUCCEEDED') {
        touchSession({ lastPaymentAt: Date.now(), lastTaskStatus: 'COMPLETED' });
      }
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Payment failed.');
    } finally {
      setPayBusy(false);
    }
  };

  const handleRetry = async () => {
    const current = payment || (payingTaskId ? paymentByTask.get(payingTaskId) || null : null);
    if (!current) return;
    setPayBusy(true);
    setPayError(null);
    try {
      const result = await onRetryPayment(current);
      setPayment(result);
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Retry failed.');
    } finally {
      setPayBusy(false);
    }
  };

  const closePayment = () => {
    setPayingTaskId(null);
    setPayment(null);
    setPayError(null);
    setLastResult(null);
  };

  const riskFactorsForTask = (task: TaskItem): string[] => {
    const tx = transactions.find((t) => t.id === task.transaction_id);
    return ((tx?.risk_factors || []).slice(0, 3).map((f) => f.message).filter(Boolean) as string[]);
  };

  const renderTaskResult = (task: TaskItem, approval: ApprovalItem | null, dismiss?: () => void) => {
    const agent = agentById.get(task.domain_agent_id);
    const def = domainDefForAgent(agent);
    return (
      <TaskResultCard
        key={task.id}
        task={task}
        approval={approval}
        agentName={agent ? agent.name : task.domain_agent_id}
        domainLabel={def ? def.label : ''}
        ruleLine={ruleLineForTask(task)}
        usualLine={usualLineForTask(task)}
        riskFactors={riskFactorsForTask(task)}
        busy={actionBusy}
        actionError={actionError}
        walletBalance={wallet?.balance ?? null}
        onApprove={(a) => runAction(() => onApprove(a), 'Approved once — your rule is unchanged.')}
        onDeny={(a) => runAction(() => onDeny(a), 'Denied.')}
        onCancelTask={(t) => setConfirmCancel(t)}
        onDismiss={dismiss}
        onPay={task.status === 'APPROVED' ? openPayment : undefined}
      />
    );
  };

  const waitingCount =
    tasks.filter((t) => t.status === 'NEEDS_REVIEW' && approvalByTask.get(t.id)?.status === 'PENDING').length +
    orphanReview.length;
  const activeUserAgents = agents.filter((a) => !a.is_task_agent && a.status === 'ACTIVE');
  const appConnections = connectionsForApps(DEMO_APPS, mandates, agents);
  const connectedApps = appConnections.filter((c) => c.mandates.length > 0);
  const activeOrders = tasks.filter((t) => t.status === 'APPROVED' || paymentByTask.has(t.id)).length;
  const flowStage: FlowStage | null = payingTaskId
    ? payment?.status === 'SUCCEEDED' || payment?.status === 'FAILED'
      ? 'result'
      : 'payment'
    : lastResult
      ? 'check'
      : draftState
        ? 'request'
        : null;

  const handleVerifyReplay = async (pay: MockPaymentItem): Promise<string> => {
    if (onVerifyReplay) return onVerifyReplay(pay);
    try {
      await executeMockPayment(pay.id);
      return 'Payment executed again — this should not happen; please report it.';
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'Replay rejected by the backend.';
    }
  };

  const renderPaymentScreen = (task: TaskItem) => {
    const agent = agentById.get(task.domain_agent_id);
    const tx = transactions.find((t) => t.id === task.transaction_id) || null;
    const approval = approvalByTask.get(task.id) || null;
    const activePayment = payment && payment.task_id === task.id ? payment : paymentByTask.get(task.id) || null;
    return (
      <PaymentScreen
        key={`pay-${task.id}`}
        task={task}
        agentName={agent ? agent.name : task.domain_agent_id}
        riskLevel={tx?.risk_level || task.risk_level}
        riskScore={tx?.risk_score ?? task.risk_score}
        riskFactors={(tx?.risk_factors || []).slice(0, 3).map((f) => f.message).filter(Boolean)}
        authReason={tx?.reason || task.reason}
        approvedOnce={approval?.status === 'APPROVED'}
        payment={activePayment}
        busy={payBusy}
        error={payError}
        onPay={(method, note) => handlePay(task, method, note)}
        onRetry={handleRetry}
        onNewRequest={closePayment}
        onViewActivity={() => onNavigate('activity')}
        onVerifyReplay={activePayment?.status === 'SUCCEEDED' ? () => handleVerifyReplay(activePayment) : undefined}
        walletBalance={wallet?.balance ?? null}
        onBack={() => {
          setPayingTaskId(null);
          setPayment(null);
          setPayError(null);
        }}
      />
    );
  };

  return (
    <div className="space-y-5">
      {/* 1. Wallet hero — backend-owned balance, never hardcoded */}
      <div className="rounded-xl bg-[#0b1c30] text-white px-5 py-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wide text-white/70">Bound Wallet · Demo Wallet</p>
            <p className="text-[34px] font-semibold tracking-tight mt-1">
              {wallet ? `₹${wallet.balance.toLocaleString()}` : '…'}
            </p>
            <p className="text-[12px] text-white/70 mt-0.5">
              {wallet ? `Available · Total spent ₹${wallet.total_debited.toLocaleString()}` : 'Loading balance from the backend…'}
            </p>
            <p className="text-[11px] text-white/50 mt-1">Payments are simulated for this demo.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] border ${backendLive === false ? 'bg-[#fdecea] text-[#93000a] border-[#ba1a1a]/25' : backendLive ? 'bg-[#e6f4ee] text-[#0a6b4a] border-[#0a6b4a]/20' : 'bg-white/10 text-white/80 border-white/20'}`}>
              {backendLive === null ? 'Connecting…' : backendLive ? 'Connected' : 'Offline'}
            </span>
            {!topupOpen ? (
              <button onClick={() => setTopupOpen(true)} className="px-3.5 py-2 rounded-lg bg-white text-[#0b1c30] text-[13px] font-medium hover:opacity-90 cursor-pointer">
                Add demo funds
              </button>
            ) : (
              <form onSubmit={handleTopup} className="flex items-center gap-1.5">
                <input
                  type="number" min="1" max="100000" step="any" value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)} aria-label="Top-up amount"
                  className="w-24 px-2.5 py-2 rounded-lg text-[13px] text-[#0b1c30] outline-none"
                />
                <button type="submit" disabled={topupBusy} className="px-3 py-2 rounded-lg bg-white text-[#0b1c30] text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60">
                  {topupBusy ? '…' : 'Add'}
                </button>
                <button type="button" onClick={() => { setTopupOpen(false); setTopupError(null); }} className="px-2 py-2 rounded-lg text-[13px] text-white/70 hover:text-white cursor-pointer">
                  ✕
                </button>
              </form>
            )}
          </div>
        </div>
        {topupError && <p className="text-[13px] text-[#ffb4ab] mt-2">{topupError}</p>}

        <div className="mt-4 pt-4 border-t border-white/15">
          <p className="text-[12px] font-medium uppercase tracking-wide text-white/70">Recent transactions</p>
          {walletTxns.filter((w) => w.kind !== 'INITIAL').length === 0 ? (
            <p className="text-[13px] text-white/70 mt-1.5">No transactions yet</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/10">
              {walletTxns.filter((w) => w.kind !== 'INITIAL').slice(0, 5).map((w) => (
                <li key={w.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] truncate">
                      <span className={`font-semibold ${w.direction === 'DEBIT' ? 'text-[#ffb4ab]' : 'text-[#7fd6a8]'}`}>
                        {w.direction === 'DEBIT' ? '−' : '+'}₹{w.amount.toLocaleString()}
                      </span>
                      <span className="text-white/70"> · {w.merchant || (w.kind === 'TOPUP' ? 'Demo funds' : w.kind === 'INITIAL' ? 'Initial demo funds' : 'Wallet')}</span>
                    </p>
                    <p className="text-[11px] text-white/50 truncate">
                      {w.created_at ? new Date(w.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                  <p className="text-[12px] text-white/70 shrink-0">Balance ₹{w.balance_after.toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {agents.length === 0 && tasks.length === 0 && (
          <button onClick={() => onNavigate('agents')} className="mt-4 w-full px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white text-[13px] font-medium hover:bg-white/15 cursor-pointer">
            Create your first agent →
          </button>
        )}
      </div>

      {/* 2. Needs attention: real pending approvals first, other review items after */}
      <div>
        <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide">Needs your attention</h2>
        <div className="mt-2.5 space-y-2.5">
          {reviewTasks.length === 0 && orphanReview.length === 0 ? (
            transactions.length === 0 && tasks.length === 0 ? (
              <EmptyState title="Nothing needs review" body="Tasks Bound can't approve will show up here with a plain-language reason." />
            ) : (
              <p className="text-[13px] text-[#0a6b4a] bg-[#e6f4ee] border border-[#0a6b4a]/20 rounded-xl px-4 py-3">
                All clear — nothing is waiting for review.
              </p>
            )
          ) : (
            <>
              {reviewTasks.map((t) => renderTaskResult(t, approvalByTask.get(t.id) || null))}
              {orphanReview.map((t) => (
                <ApprovalCard
                  key={t.id}
                  tx={t}
                  agentDisplay={t.agent}
                  ruleLine={ruleLineForTx(t)}
                  usualLine={usualLineForTx(t)}
                  onReview={onSelectTransaction}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 3. Ask Bound */}
      <AskBar onAsk={handleAsk} preset={askPreset} />

      {/* 4. At a glance — control center summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button onClick={() => onNavigate('agents')} className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3 text-left hover:border-[#9a9ba1] cursor-pointer">
          <p className="text-[22px] font-semibold text-[#0b1c30]">{activeUserAgents.length}</p>
          <p className="text-[12px] text-[#5a5c63] mt-0.5">Active agent{activeUserAgents.length === 1 ? '' : 's'}</p>
          <p className="text-[12px] text-[#0051d5] font-medium mt-1">Agents →</p>
        </button>
        <button onClick={() => onNavigate('apps')} className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3 text-left hover:border-[#9a9ba1] cursor-pointer">
          <p className="text-[22px] font-semibold text-[#0b1c30]">{connectedApps.length}<span className="text-[14px] font-normal text-[#76777d]">/{DEMO_APPS.length}</span></p>
          <p className="text-[12px] text-[#5a5c63] mt-0.5 truncate">
            {connectedApps.length === 0 ? 'No apps connected' : `Connected: ${connectedApps.map((c) => c.app.name).slice(0, 2).join(', ')}${connectedApps.length > 2 ? '…' : ''}`}
          </p>
          <p className="text-[12px] text-[#0051d5] font-medium mt-1">Apps →</p>
        </button>
        <div className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3">
          <p className={`text-[22px] font-semibold ${waitingCount > 0 ? 'text-[#93000a]' : 'text-[#0a6b4a]'}`}>{waitingCount}</p>
          <p className="text-[12px] text-[#5a5c63] mt-0.5">Waiting approval</p>
          <p className="text-[12px] text-[#76777d] mt-1">{waitingCount === 0 ? 'All clear' : 'Review above'}</p>
        </div>
        <button onClick={() => onNavigate('orders')} className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3 text-left hover:border-[#9a9ba1] cursor-pointer">
          <p className="text-[22px] font-semibold text-[#0b1c30]">{activeOrders}</p>
          <p className="text-[12px] text-[#5a5c63] mt-0.5">Active order{activeOrders === 1 ? '' : 's'} & trips</p>
          <p className="text-[12px] text-[#0051d5] font-medium mt-1">Orders & Trips →</p>
        </button>
      </div>

      {notUnderstood && (
        <p className="text-[13px] text-[#5a5c63] bg-white border border-[#e2e3e8] rounded-xl px-4 py-3">{notUnderstood}</p>
      )}

      {conversation && (
        <ConversationCard
          state={conversation}
          onPickDomain={pickDomainForPending}
          onAcceptBudget={acceptBudget}
          onAcceptLast={acceptLast}
          onEnterManually={enterManually}
          onDismiss={() => {
            setConversation(null);
            setPendingRefAsk(null);
          }}
        />
      )}

      {flowStage && (
        <div className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3">
          <FlowSteps stage={flowStage} />
        </div>
      )}

      {draftState && (
        <TaskCard
          key={draftState.nonce}
          draft={draftState.draft}
          agent={draftAgent}
          mandate={draftMandate}
          domainId={draftState.domainId}
          merchantSuggestions={merchantSuggestions}
          checking={checking}
          checkError={checkError}
          onSelectDomain={handlePickDomain}
          onSetupDomain={onSetupDomain}
          onCheck={handleCheck}
          onDismiss={() => {
            setDraftState(null);
            setCheckError(null);
          }}
          notes={draftState.notes}
          initialMerchant={draftState.merchantSeed}
        />
      )}

      {lastResult && renderTaskResult(lastResult.task, lastResult.approval, () => setLastResult(null))}

      {payingTaskId &&
        (() => {
          const task = tasks.find((t) => t.id === payingTaskId) || lastResult?.task || null;
          if (!task || task.status !== 'APPROVED') return null;
          return renderPaymentScreen(task);
        })()}

      {/* Live tasks */}
      {otherTasks.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide">Your tasks</h2>
          <ul className="mt-2.5 space-y-2">
            {otherTasks.map((t) => {
              const agent = agentById.get(t.domain_agent_id);
              const pay = paymentByTask.get(t.id);
              return (
                <li key={t.id} className="rounded-xl bg-white border border-[#e2e3e8] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#0b1c30] truncate">
                      <span className="font-medium">{t.purpose}</span> — up to ₹{t.requested_amount.toLocaleString()} at {t.merchant}
                    </p>
                    <p className="text-[12px] text-[#76777d] truncate">
                      {agent ? agent.name : t.domain_agent_id} · {t.status === 'APPROVED' ? 'Approved' : 'Checking…'}
                      {pay?.status === 'SUCCEEDED' ? ' · Paid (demo)' : pay ? ` · Payment ${pay.status.toLowerCase()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.status === 'APPROVED' && pay?.status !== 'SUCCEEDED' && (
                      <button onClick={() => openPayment(t)} className="px-3 py-1.5 rounded-lg bg-[#0b1c30] text-white text-[12px] font-medium hover:opacity-90 cursor-pointer">
                        Pay →
                      </button>
                    )}
                    {t.status === 'PENDING' && (
                      <button onClick={() => setConfirmCancel(t)} className="text-[13px] text-[#76777d] hover:text-[#93000a] cursor-pointer">
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Domain agents */}
      <div>
        <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide">Your agents</h2>
        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DOMAINS.map((d) => {
            const res = resolutions.get(d.id);
            if (!res) {
              return (
                <div key={d.id} className="rounded-xl bg-white border border-dashed border-[#c6c6cd] p-4">
                  <p className="text-[22px]">{d.icon}</p>
                  <p className="text-[14px] font-semibold text-[#0b1c30] mt-1">{d.label}</p>
                  <p className="text-[12px] text-[#76777d] mt-0.5">Not set up yet</p>
                  <button onClick={() => onSetupDomain(d.id)} className="mt-2.5 text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer">
                    Set up →
                  </button>
                </div>
              );
            }
            return (
              <div key={d.id} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
                <p className="text-[22px]">{d.icon}</p>
                <p className="text-[14px] font-semibold text-[#0b1c30] mt-1">{res.agent.name}</p>
                <p className="text-[13px] text-[#0b1c30] mt-0.5">{ruleSummary(res.mandate, d)}</p>
                <p className="text-[12px] text-[#76777d] mt-0.5 truncate">{res.mandate.purpose}</p>
                <button onClick={() => onNavigate('agents')} className="mt-2.5 text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer">
                  View agent →
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent agent activity — real backend events, newest first */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[#0b1c30] uppercase tracking-wide">Recent agent activity</h2>
          <button onClick={() => onNavigate('activity')} className="text-[13px] font-medium text-[#0051d5] hover:underline cursor-pointer">
            Activity →
          </button>
        </div>
        <div className="mt-2.5 rounded-xl bg-white border border-[#e2e3e8] overflow-hidden">
          <ActivityFeed transactions={transactions} tasks={tasks} approvals={approvals} payments={payments} limit={8} />
        </div>
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title={`Cancel “${confirmCancel.purpose}”?`}
          body="The task stops here. Its temporary authority is revoked and any pending approval is invalidated. Past records are kept."
          confirmLabel="Cancel task"
          danger
          busy={actionBusy}
          onCancel={() => setConfirmCancel(null)}
          onConfirm={async () => {
            await runAction(() => onCancelTask(confirmCancel), 'Task cancelled.');
            setConfirmCancel(null);
          }}
        />
      )}
    </div>
  );
};
