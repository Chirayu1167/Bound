export type ActiveTab = 'overview' | 'agents' | 'mandates' | 'delegations' | 'transactions' | 'security' | 'violation';

export interface AgentNode {
  id: string;
  name: string;
  runtimeId: string;
  status: 'ACTIVE' | 'REVOKED' | 'IDLE';
  creator: string;
  creatorSub: string;
  cap: string;
  scopeSummary: string;
  heartbeat: string;
  heartbeatCode: string;
  authorizedAmount: number;
  requestedAmount: number;
  remainingHeadroom: number;
  policy: string;
  hash: string;
  mccAllowed: string[];
  expiryDate: string;
  velocityLimit: string;
  canSubDelegate: boolean;
  delegationTarget?: string;
  purpose: string;
}

export interface MandateItem {
  id: string;
  code: string;
  name: string;
  expiry: string;
  spent: number;
  cap: number;
  safeBuffer: string;
  isThresholdImminent?: boolean;
  boundAgent: string;
  subDelegationNote?: string;
  agentHash: string;
  permittedScopeTitle: string;
  mccCode: string;
  mccDetail: string;
  status: 'ACTIVE' | 'REVOKED';
}

export interface RiskFactor {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
}

export interface TransactionRecord {
  id: string;
  time: string;
  agent: string;
  agentColor: string;
  action: string;
  amount: string;
  decision: 'ALLOW' | 'VERIFY' | 'BLOCK';
  statusLabel: string;
  verificationType: 'proof' | 'violation';
  merchant: string;
  mcc: string;
  rawAmount: number;
  timestamp: string;
  authorization_status?: string | null;
  risk_score?: number | null;
  risk_level?: string | null;
  risk_factors?: RiskFactor[] | null;
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
  raw: any;
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
  rootMandate?: any;
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

export interface AuditStep {
  stepNumber: number;
  title: string;
  badge: string;
  timestamp: string;
  description: string;
  detailLabel: string;
  detailValue: string;
  isTerminal?: boolean;
}
