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
import { ProposalCard, type ProposalInput } from '../components/ProposalCard';
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
  onPayTask: (task: TaskItem, method: string, note: string, actual: number, item: string | null) => Promise<MockPaymentItem>;
  onRetryPayment: (payment: MockPaymentItem, actual: number | null, item: string | null) => Promise<MockPaymentItem>;
  onRevokeAgent: (agentId: string) => Promise<void>;
  onSetupDomain: (domainId: DomainId) => void;
  notify: (msg: string) => void;
  onVerifyReplay?: (payment: MockPaymentItem) => Promise<string>;
  onTopup: (amount: number) => Promise<void>;
  onQuickCreateAgent: (domainId: DomainId) => Promise<void>;
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

/** Default merchant per domain when neither the request nor history names one. Bills varies too much — always ask. */
const DOMAIN_DEFAULT_MERCHANT: Record<DomainId, string | null> = {
  food: 'Swiggy',
  travel: 'IndiGo',
  shopping: 'Amazon',
  bills: null,
};

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
  onQuickCreateAgent,
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
  // Original request text, kept so creating a missing agent can continue it.
  const [pendingText, setPendingText] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  // Edit-mode toggle: the proposal card is the default smart path; the full
  // TaskCard form is one tap away for anything unusual.
  const [editMode, setEditMode] = useState(false);
  const [execBusy, setExecBusy] = useState(false);
  const [execStage, setExecStage] = useState<'checking' | 'paying' | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  // Auto-run: the agent works a fully-resolved request on its own (one tap
  // was the typed request itself). Anything ambiguous falls back to manual.
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoStage, setAutoStage] = useState<'checking' | 'paying' | null>(null);
  const [autoInfo, setAutoInfo] = useState<{ agentName: string; icon: string; purpose: string; merchant: string; max: number } | null>(null);
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

  /** Merchant resolution order: named > usual spot (history) > domain default. */
  const resolveMerchantFor = (domainId: DomainId, override: string | null): { merchant: string | null; note: string | null } => {
    if (override) return { merchant: override, note: null };
    const def = DOMAINS.find((d) => d.id === domainId);
    const last = historyForDomain(transactions, def?.categories || []).last;
    if (last?.merchant) return { merchant: last.merchant, note: `Usual spot: ${last.merchant} — change it below.` };
    const usual = DOMAIN_DEFAULT_MERCHANT[domainId];
    if (usual) return { merchant: usual, note: `Trying ${usual} — change it below.` };
    return { merchant: null, note: null };
  };

  /**
   * Auto-run: a fully-resolved request (agent + amount + merchant) executes
   * on its own — the typed request is the instruction, the standing rule is
   * the permission. Real authorize → (if APPROVED) real pay, with visible
   * progress. Anything else (no agent, review, error) falls back to the
   * manual cards. Returns true when it took the request.
   */
  const autoRun = async (
    domainId: DomainId,
    purpose: string,
    budget: number,
    merchant: string,
    notes: string[]
  ): Promise<boolean> => {
    const res = resolveDomainAgent(domainId, agents, mandates);
    if (!res) return false;
    const def = DOMAINS.find((d) => d.id === domainId);
    setAutoBusy(true);
    setAutoStage('checking');
    setAutoInfo({ agentName: res.agent.name, icon: def?.icon || '🤖', purpose, merchant, max: budget });
    try {
      const draft = createTaskDraft(domainId, purpose, budget, res.agent.id, res.mandate.id);
      const result = await onCheckTask({ draft, merchant, purpose, budget });
      touchSession({
        domainId, purpose, amount: budget, merchant,
        agentId: result.task.domain_agent_id,
        lastTaskStatus: result.task.status,
      });
      if (result.task.status !== 'APPROVED') {
        setLastResult({ task: result.task, approval: result.approval });
        return true;
      }
      setAutoStage('paying');
      openPayment(result.task);
      const item = purpose && purpose !== DOMAIN_DEFAULT_PURPOSE[domainId] ? purpose : null;
      await handlePay(result.task, 'Demo Balance', '', budget, item);
      return true;
    } catch (e: unknown) {
      // Stranded requests fall back to an editable draft, never vanish.
      setDraftState({
        draft: createTaskDraft(domainId, purpose, budget, res.agent.id, res.mandate.id),
        domainId, notes: [...notes, 'Auto-run hit a snag — review and continue manually.'],
        nonce: Date.now(), merchantSeed: merchant,
      });
      notify(e instanceof Error ? e.message : 'Auto-run failed — continue manually below.');
      return true;
    } finally {
      setAutoBusy(false);
      setAutoStage(null);
      setAutoInfo(null);
    }
  };

  const handleAsk = async (text: string) => {
    if (autoBusy || checking) return;
    setLastResult(null);
    setCheckError(null);
    setConversation(null);
    setPendingRefAsk(null);
    setPendingText(text);
    setEditMode(false);
    setExecError(null);
    const deterministic = parseRequest(text);
    // Groq first: understands phrasing the keyword parser misses ("pizza",
    // merchant names like Domino's). Draft-only pre-fill — it never
    // authorizes, and any failure falls back to the deterministic parser.
    let intent = deterministic;
    let groqMerchant: string | null = null;
    if (text.trim()) {
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
            const purpose = g.purpose || DOMAIN_DEFAULT_PURPOSE[d];
            const resolved = resolveMerchantFor(d, g.merchant);
            const allNotes = [...notes, ...(resolved.note ? [resolved.note] : [])];
            // Fully resolved → the agent just does it. Otherwise the draft
            // card takes over for the missing piece.
            if (g.budget != null && resolved.merchant) {
              if (await autoRun(d, purpose, g.budget, resolved.merchant, allNotes)) return;
            }
            setNotUnderstood(null);
            setDraftState({ ...makeDraftState(d, purpose, g.budget, resolved.merchant, allNotes) });
            touchSession({ domainId: d, purpose: g.purpose ?? null, amount: g.budget, merchant: resolved.merchant });
            return;
          }
          intent = { ...intent, kind: 'request', purpose: g.purpose ?? intent.purpose, budget: g.budget ?? intent.budget, notes };
          groqMerchant = g.merchant;
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
        await routeAsk(text, intent, null, groqMerchant);
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
      const fallbackDef = DOMAINS.find((d) => d.id === fallback);
      const fallbackLast = historyForDomain(transactions, fallbackDef?.categories || []).last;
      const fallbackSeed = groqMerchant || fallbackLast?.merchant || DOMAIN_DEFAULT_MERCHANT[fallback];
      const fallbackNotes = [
        ...intent.notes,
        ...(groqMerchant || fallbackLast?.merchant || !DOMAIN_DEFAULT_MERCHANT[fallback]
          ? []
          : [`Trying ${DOMAIN_DEFAULT_MERCHANT[fallback]} — change it below.`]),
        ...(fallbackLast?.merchant && !groqMerchant ? [`Usual spot: ${fallbackLast.merchant} — change it below.`] : []),
      ];
      if (intent.budget != null && fallbackSeed && ref === 'none') {
        if (await autoRun(fallback, intent.purpose || 'Order', intent.budget, fallbackSeed, fallbackNotes)) return;
      }
      setDraftState({ ...makeDraftState(fallback, intent.purpose || 'Order', intent.budget, fallbackSeed, fallbackNotes) });
      touchSession({ domainId: fallback, purpose: intent.purpose ?? null });
      return;
    }
    await routeAsk(text, intent, null, groqMerchant);
  };

  /** Route a parsed request, optionally with a domain forced by disambiguation. */
  const routeAsk = async (text: string, intent: ParsedIntent, forcedDomain: DomainId | null, merchantSeedOverride: string | null = null) => {
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
    // borrowed from context (or the AI suggestion) when the text names none.
    const domainId = forcedDomain ?? intent.domainId ?? session.domainId;
    if (!domainId) return;
    const def = DOMAINS.find((d) => d.id === domainId);
    // Borrow a merchant only when the text names none: AI suggestion first,
    // then session (most recent interaction), else last historical merchant,
    // else the domain's usual spot. Still editable, still requires confirm.
    let merchantSeed: string | null = merchantSeedOverride;
    const seedNotes: string[] = [];
    if (!merchantSeed && (ref === 'last-transaction' || ref === 'same-merchant')) {
      const last = historyForDomain(transactions, def?.categories || []).last;
      merchantSeed =
        session.domainId === domainId && session.merchant
          ? session.merchant
          : last?.merchant || null;
    }
    if (!merchantSeed) {
      const last = historyForDomain(transactions, def?.categories || []).last;
      if (last?.merchant) {
        merchantSeed = last.merchant;
        seedNotes.push(`Usual spot: ${last.merchant} — change it below.`);
      } else {
        const usual = DOMAIN_DEFAULT_MERCHANT[domainId];
        if (usual) {
          merchantSeed = usual;
          seedNotes.push(`Trying ${usual} — change it below.`);
        }
      }
    }
    setNotUnderstood(null);
    const allNotes = [...intent.notes, ...seedNotes];
    // Direct request with everything resolved → the agent just does it.
    if (ref === 'none' && intent.budget != null && merchantSeed) {
      if (await autoRun(domainId, intent.purpose || 'Order', intent.budget, merchantSeed, allNotes)) return;
    }
    setDraftState({
      ...makeDraftState(domainId, intent.purpose || 'Order', intent.budget, merchantSeed, allNotes),
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
    void routeAsk(text, parseRequest(text), d);
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
      // Within authority the check approves outright — take the user straight
      // to payment (they still confirm and click Pay; money never moves alone).
      if (result.task.status === 'APPROVED') {
        openPayment(result.task);
      }
    } catch (e: unknown) {
      setCheckError(e instanceof Error ? e.message : 'The check failed.');
    } finally {
      setChecking(false);
    }
  };

  /** One-tap agent execution: authorize, and when approved pay immediately
   * with the confirmed final amount. Anything needing review falls back to
   * the approval UI. Two real backend calls, one user tap — the tap shows
   * agent, merchant, max, charge and wallet impact up front. */
  const handleConfirmPay = async (input: ProposalInput) => {
    if (!draftState) return;
    setExecBusy(true);
    setExecError(null);
    setExecStage('checking');
    try {
      const result = await onCheckTask({
        draft: draftState.draft,
        merchant: input.merchant,
        purpose: draftState.draft.purpose,
        budget: input.max,
      });
      touchSession({
        merchant: input.merchant,
        amount: input.charge,
        agentId: result.task.domain_agent_id,
        lastTaskStatus: result.task.status,
      });
      if (result.task.status !== 'APPROVED') {
        setLastResult({ task: result.task, approval: result.approval });
        setDraftState(null);
        setConversation(null);
        notify('Needs review — see why below.');
        return;
      }
      setExecStage('paying');
      openPayment(result.task);
      await handlePay(result.task, 'Demo Balance', '', input.charge, input.item);
      setDraftState(null);
      setConversation(null);
    } catch (e: unknown) {
      setExecError(e instanceof Error ? e.message : 'That didn\u2019t work.');
    } finally {
      setExecBusy(false);
      setExecStage(null);
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
  const draftDomainHasAgent = draftState
    ? agents.some((a) => a.domain === draftState.domainId.toUpperCase() && a.status === 'ACTIVE' && !a.is_task_agent)
    : true;

  /** One-click agent creation that continues the saved request afterwards. */
  const handleQuickCreate = async () => {
    if (!draftState) return;
    const def = DOMAINS.find((d) => d.id === draftState.domainId);
    if (!def) return;
    setQuickBusy(true);
    setQuickError(null);
    try {
      await onQuickCreateAgent(def.id);
      if (pendingText) await handleAsk(pendingText);
    } catch (e: unknown) {
      setQuickError(e instanceof Error ? e.message : 'Could not create the agent.');
    } finally {
      setQuickBusy(false);
    }
  };

  const openPayment = (task: TaskItem) => {
    setPayingTaskId(task.id);
    setPayment(paymentByTask.get(task.id) || null);
    setPayError(null);
  };

  const handlePay = async (task: TaskItem, method: string, note: string, actual: number, item: string | null) => {
    setPayBusy(true);
    setPayError(null);
    try {
      const result = await onPayTask(task, method, note, actual, item);
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

  const handleRetry = async (actual: number | null, item: string | null) => {
    const current = payment || (payingTaskId ? paymentByTask.get(payingTaskId) || null : null);
    if (!current) return;
    setPayBusy(true);
    setPayError(null);
    try {
      const result = await onRetryPayment(current, actual, item);
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
        onPay={(method, note, actual, item) => handlePay(task, method, note, actual, item)}
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
      <AskBar onAsk={handleAsk} preset={askPreset} busy={autoBusy} />

      {autoBusy && autoInfo && !payingTaskId && (
        <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#0b1c30] text-white flex items-center justify-center text-[18px] shrink-0">
              {autoInfo.icon}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-[#0b1c30] truncate">
                {autoInfo.agentName} is on it
              </h2>
              <p className="text-[12px] text-[#76777d] truncate">
                {autoInfo.purpose} · {autoInfo.merchant} · up to ₹{autoInfo.max.toLocaleString()}
              </p>
            </div>
            <span className="w-5 h-5 border-[3px] border-[#e2e3e8] border-t-[#0b1c30] rounded-full animate-spin shrink-0" />
          </div>
          <div className="mt-3 rounded-lg bg-[#f7f8fb] border border-[#eef0f4] px-3 py-2.5 space-y-1">
            <p className="text-[13px] text-[#0a6b4a]">✓ Understood your request</p>
            <p className={`text-[13px] ${autoStage === 'checking' ? 'text-[#0b1c30] font-medium' : 'text-[#0a6b4a]'}`}>
              {autoStage === 'checking' ? '●' : '✓'} Checking authority with Bound
            </p>
            {autoStage === 'paying' && (
              <p className="text-[13px] text-[#0b1c30] font-medium">● Paying from your demo wallet…</p>
            )}
          </div>
        </div>
      )}

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

      {draftState && !draftDomainHasAgent && (() => {
        const def = DOMAINS.find((d) => d.id === draftState.domainId);
        if (!def) return null;
        return (
          <div className="rounded-xl bg-white border border-[#0b1c30]/25 p-5">
            <h2 className="text-[15px] font-semibold text-[#0b1c30]">
              You don&apos;t have a {def.agentLabel} yet. Create one?
            </h2>
            <p className="text-[13px] text-[#5a5c63] mt-1.5">
              It gets a bounded rule — {def.suggestedPurpose}, up to ₹{def.suggestedCap.toLocaleString()} per {def.unitWord} — 
              never access to all your money. Your request continues automatically after creation.
            </p>
            {quickError && <p className="text-[13px] text-[#93000a] mt-2">{quickError}</p>}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleQuickCreate}
                disabled={quickBusy}
                className="px-4 py-2 rounded-lg bg-[#0b1c30] text-white text-[13px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-60"
              >
                {quickBusy ? 'Creating…' : `Create ${def.agentLabel}`}
              </button>
              <button
                onClick={() => { setDraftState(null); setCheckError(null); }}
                disabled={quickBusy}
                className="px-4 py-2 rounded-lg bg-[#eef1f6] text-[#0b1c30] text-[13px] font-medium hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60"
              >
                Not now
              </button>
            </div>
          </div>
        );
      })()}

      {draftState && draftDomainHasAgent && draftAgent && draftMandate && draftState.draft.budget != null && !editMode && (
        <ProposalCard
          key={`proposal-${draftState.nonce}`}
          agentName={draftAgent.name}
          agentIcon={draftDef?.icon || '🤖'}
          ruleLine={draftDef ? ruleSummary(draftMandate, draftDef) : null}
          purpose={draftState.draft.purpose}
          notes={draftState.notes}
          initialMerchant={draftState.merchantSeed}
          initialMax={draftState.draft.budget}
          walletBalance={wallet?.balance ?? null}
          busy={execBusy}
          stage={execStage}
          error={execError}
          onConfirm={handleConfirmPay}
          onEdit={() => setEditMode(true)}
          onDismiss={() => {
            setDraftState(null);
            setCheckError(null);
            setExecError(null);
          }}
        />
      )}

      {draftState && draftDomainHasAgent && (editMode || !draftAgent || !draftMandate || draftState.draft.budget == null) && (
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
