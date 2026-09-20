export type ActiveTab = 'wallet' | 'agents' | 'apps' | 'orders' | 'activity' | 'audit' | 'preferences';

export type AgentDomain = 'FOOD' | 'TRAVEL' | 'SHOPPING' | 'OTHER';

export interface AgentNode {
  id: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'REVOKED';
  /** Explicit backend domain — never inferred in the UI. */
  domain: AgentDomain;
  /** True for ephemeral single-task machinery. Hidden from user agent lists. */
  is_task_agent: boolean;
  created_at: string;
}

export type TaskStatus = 'PENDING' | 'APPROVED' | 'NEEDS_REVIEW' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export type MockPaymentStatus = 'CREATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface MockPaymentItem {
  id: string;
  task_id: string;
  transaction_id: string | null;
  merchant: string;
  amount: number;
  currency: string;
  status: MockPaymentStatus;
  payment_method: string;
  note: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  /** Demo-wallet balance after this payment debited; null until SUCCEEDED. */
  wallet_balance_after: number | null;
}

export interface TaskItem {
  id: string;
  domain_agent_id: string;
  task_agent_id: string | null;
  purpose: string;
  requested_amount: number;
  task_limit: number;
  category: string;
  merchant: string;
  status: TaskStatus;
  delegation_id: string | null;
  transaction_id: string | null;
  created_at: string;
  expires_at: string;
  decision: string | null;
  reason: string | null;
  authorization_status: string | null;
  risk_score: number | null;
  risk_level: string | null;
}

export interface ApprovalItem {
  id: string;
  task_id: string;
  transaction_id: string | null;
  amount: number;
  reason: string;
  risk_level: string | null;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

export interface MandateItem {
  id: string;
  code: string;
  agent_id: string;
  agentName: string;
  purpose: string;
  max_amount: number;
  cap: number;
  merchant_category: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  created_at: string;
  expires_at: string | null;
  expiresLabel: string;
  // Legacy display helpers (kept for compat, derived from real fields)
  name: string;
  boundAgent: string;
  expiry: string;
}

export interface RiskFactor {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
}

export interface TransactionRecord {
  id: string;
  agent_id: string;
  agent: string;
  amount: string;
  rawAmount: number;
  decision: 'ALLOW' | 'VERIFY';
  reason: string;
  merchant: string;
  merchant_category: string;
  purpose: string;
  mandate_id: string | null;
  delegation_id: string | null;
  created_at: string;
  time: string;
  timestamp: string;
  authorization_status: string | null;
  risk_score: number | null;
  risk_level: string | null;
  risk_factors: RiskFactor[] | null;
  // compat
  action: string;
  mcc: string;
  statusLabel: string;
}

export interface DelegationItem {
  id: string;
  parentAgentId: string;
  parentAgentName: string;
  childAgentId: string;
  childAgentName: string;
  parentMandateId: string;
  parentMandateName: string;
  delegatedLimit: number;
  delegatedLimitFormatted: string;
  purpose: string;
  merchantCategory: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string | null;
  expiresLabel: string;
  raw: unknown;
}

export interface DelegationChainStep {
  step: string;
  id?: string;
  name?: string;
  detail?: string;
}

export interface DelegationChain {
  delegationId: string | null;
  chain: DelegationChainStep[];
  rootMandate?: unknown;
  delegation?: DelegationItem | null;
}

export interface ProvenanceEvent {
  id: string;
  sequence_number: number;
  event_type: string;
  timestamp: string;
  actor_agent_id?: string | null;
  parent_agent_id?: string | null;
  mandate_id?: string | null;
  delegation_id?: string | null;
  transaction_id?: string | null;
  decision?: string | null;
  reason?: string | null;
  event_data?: string | null;
  previous_hash?: string | null;
  event_hash: string;
}

export interface ProvenanceVerifyResult {
  valid: boolean;
  events_checked: number;
  first_event?: string | null;
  last_event?: string | null;
  first_hash?: string | null;
  last_hash?: string | null;
  message?: string | null;
  broken_event_id?: string | null;
  reason?: string | null;
  expected_previous?: string | null;
  actual_previous?: string | null;
  expected_hash?: string | null;
  actual_hash?: string | null;
  expected_sequence?: number | null;
  actual_sequence?: number | null;
}
