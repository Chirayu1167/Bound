import { AgentNode, MandateItem, TransactionRecord, AuditStep } from '../types';

export const INITIAL_AGENTS: AgentNode[] = [
  {
    id: 'shopping-agent',
    name: 'Shopping Agent',
    runtimeId: 'agt_01h8x9p3km',
    status: 'ACTIVE',
    creator: 'Root Vault',
    creatorSub: '#492 (You)',
    cap: '₹2,000',
    scopeSummary: 'Grocery MCC limits',
    heartbeat: '2m ago',
    heartbeatCode: 'tx_ack',
    authorizedAmount: 2000,
    requestedAmount: 800,
    remainingHeadroom: 1200,
    policy: 'HARD_STOP_AT_100%',
    hash: 'sha256:7e01b…89c',
    mccAllowed: ['MCC 5411 (Grocery Stores)', 'MCC 5499 (Misc Food Markets)'],
    expiryDate: '20 Sep 2026',
    velocityLimit: 'Max 3 Tx / 24h',
    canSubDelegate: true,
    delegationTarget: 'Payment Agent',
    purpose: 'Groceries (Food supplies, supermarkets, household essentials only)'
  },
  {
    id: 'payment-agent',
    name: 'Payment Agent',
    runtimeId: 'agt_09v4c1k9qa',
    status: 'ACTIVE',
    creator: 'Shopping Agent',
    creatorSub: 'Sub-delegated',
    cap: '₹2,000',
    scopeSummary: 'Execution pipe only',
    heartbeat: 'Active now',
    heartbeatCode: 'idle_wait',
    authorizedAmount: 2000,
    requestedAmount: 800,
    remainingHeadroom: 1200,
    policy: 'EPHEMERAL_TOKEN_10M',
    hash: 'sha256:41bf0…77a',
    mccAllowed: ['MCC 5411 (Grocery Stores)'],
    expiryDate: '20 Sep 2026',
    velocityLimit: 'Max 1 Tx / delegation',
    canSubDelegate: false,
    purpose: 'Downstream virtual card tokenizer on behalf of Shopping Agent'
  },
  {
    id: 'travel-agent',
    name: 'Travel Agent',
    runtimeId: 'agt_74m9k2x1po',
    status: 'REVOKED',
    creator: 'Root Vault',
    creatorSub: '#492 (You)',
    cap: '₹8,000',
    scopeSummary: 'Airlines / Hotel',
    heartbeat: 'Revoked 2h ago',
    heartbeatCode: 'sig_kill',
    authorizedAmount: 8000,
    requestedAmount: 7450,
    remainingHeadroom: 550,
    policy: 'POLICY_REVOKED_403',
    hash: 'sha256:3a42d…109',
    mccAllowed: ['MCC 3000-3350 (Commercial Airlines)', 'MCC 7011 (Hotels)'],
    expiryDate: '15 Oct 2026',
    velocityLimit: 'Max 1 Tx / 48h',
    canSubDelegate: false,
    purpose: 'Corporate travel booking with automated flight & accommodation settlement'
  },
  {
    id: 'analytics-agent',
    name: 'Analytics Agent',
    runtimeId: 'agt_33r8f7z6ly',
    status: 'IDLE',
    creator: 'Acme Finance Ops',
    creatorSub: 'Service Principal',
    cap: '₹0',
    scopeSummary: 'Read-only audit',
    heartbeat: '1d ago',
    heartbeatCode: 'sync_ok',
    authorizedAmount: 0,
    requestedAmount: 0,
    remainingHeadroom: 0,
    policy: 'ZERO_PAYMENT_PERMITTED',
    hash: 'sha256:91c2b…e01',
    mccAllowed: ['NONE (Read-Only State)'],
    expiryDate: '31 Dec 2026',
    velocityLimit: 'Unlimited Query',
    canSubDelegate: false,
    purpose: 'Telemetry observer for budget analytics and velocity threshold modeling'
  }
];

export const INITIAL_MANDATES: MandateItem[] = [
  {
    id: 'mnd-4091',
    code: 'MND-4091',
    name: 'Groceries',
    expiry: 'Expires 20 Sep 2026',
    spent: 1460,
    cap: 2000,
    safeBuffer: '₹540 Safe Buffer Remaining',
    boundAgent: 'Shopping Agent',
    subDelegationNote: 'Sub-delegates to Payment Agent',
    agentHash: 'sha256:7e01b…89c',
    permittedScopeTitle: 'Supermarkets, Food & Daily Provisions',
    mccCode: 'MCC 5411',
    mccDetail: 'Strict Isolation',
    status: 'ACTIVE'
  },
  {
    id: 'mnd-1108',
    code: 'MND-1108',
    name: 'Flight Booking',
    expiry: 'Expires 15 Oct 2026',
    spent: 7450,
    cap: 8000,
    safeBuffer: '₹550 Limit Threshold Imminent',
    isThresholdImminent: true,
    boundAgent: 'Travel Agent',
    subDelegationNote: 'Direct execution (Solo Agent)',
    agentHash: 'sha256:3a42d…109',
    permittedScopeTitle: 'Commercial Airlines',
    mccCode: 'MCC 3000-3350',
    mccDetail: 'OTA Enforced',
    status: 'ACTIVE'
  },
  {
    id: 'mnd-0024',
    code: 'MND-0024',
    name: 'Old Shopping Permission',
    expiry: 'Expired 01 Aug 2026',
    spent: 2000,
    cap: 2000,
    safeBuffer: 'Lifecycle Terminated',
    boundAgent: 'Shopping Agent (v1 legacy)',
    subDelegationNote: 'Deprecated Runtime',
    agentHash: 'sha256:008ca…f12',
    permittedScopeTitle: 'Groceries',
    mccCode: 'MCC Legacy',
    mccDetail: 'Decommissioned',
    status: 'REVOKED'
  },
  {
    id: 'mnd-8820',
    code: 'MND-8820',
    name: 'Cloud Infrastructure Emergency Buffer',
    expiry: 'Expires 31 Dec 2026',
    spent: 0,
    cap: 5000,
    safeBuffer: 'Full Contingency Reserve Online',
    boundAgent: 'Ops Agent',
    subDelegationNote: 'Direct Enclave Automation',
    agentHash: 'sha256:5503a…11c',
    permittedScopeTitle: 'AWS, GCP, Cloudflare Hosting only',
    mccCode: 'Cloud Specific',
    mccDetail: 'Whitelisted VPA',
    status: 'ACTIVE'
  }
];

export const INITIAL_TRANSACTIONS: TransactionRecord[] = [
  {
    id: 'tx_901923',
    time: '12:42',
    agent: 'Shopping Agent',
    agentColor: 'bg-on-tertiary-container',
    action: 'Grocery payment (ABC Supermarket)',
    amount: '₹820',
    rawAmount: 820,
    decision: 'ALLOW',
    statusLabel: 'ALLOW',
    verificationType: 'proof',
    merchant: 'ABC Supermarket',
    mcc: '5411 · Groceries',
    timestamp: 'Today, 12:42:09 IST'
  },
  {
    id: 'tx_901844',
    time: '12:37',
    agent: 'Payment Agent',
    agentColor: 'bg-secondary',
    action: 'Electronics (QuickElectro Ltd)',
    amount: '₹3,500',
    rawAmount: 3500,
    decision: 'VERIFY',
    statusLabel: 'VERIFY',
    verificationType: 'violation',
    merchant: 'QuickElectro Ltd',
    mcc: '5732 · Consumer Electronics',
    timestamp: 'Today, 12:37:41 IST'
  },
  {
    id: 'tx_901712',
    time: '11:58',
    agent: 'Shopping Agent',
    agentColor: 'bg-on-tertiary-container',
    action: 'Grocery payment (FreshDirect)',
    amount: '₹640',
    rawAmount: 640,
    decision: 'ALLOW',
    statusLabel: 'ALLOW',
    verificationType: 'proof',
    merchant: 'FreshDirect',
    mcc: '5411 · Groceries',
    timestamp: 'Today, 11:58:14 IST'
  },
  {
    id: 'tx_901509',
    time: '09:14',
    agent: 'Travel Agent',
    agentColor: 'bg-outline-variant',
    action: 'Flight Booking (IndiGo 6E-204)',
    amount: '₹7,450',
    rawAmount: 7450,
    decision: 'ALLOW',
    statusLabel: 'ALLOW',
    verificationType: 'proof',
    merchant: 'IndiGo Airlines',
    mcc: '3000-3350 · Commercial Airlines',
    timestamp: 'Today, 09:14:02 IST'
  },
  {
    id: 'tx_899211',
    time: 'Yesterday',
    agent: 'Cloud Infra Agent',
    agentColor: 'bg-on-tertiary-container',
    action: 'Server burst compute',
    amount: '₹1,200',
    rawAmount: 1200,
    decision: 'ALLOW',
    statusLabel: 'ALLOW',
    verificationType: 'proof',
    merchant: 'AWS Cloud Compute',
    mcc: '7372 · Cloud Hosting',
    timestamp: 'Yesterday, 16:45:00 IST'
  }
];

export const PROVENANCE_STEPS: AuditStep[] = [
  {
    stepNumber: 1,
    title: '1. User Intent',
    badge: 'POLICY_AUTH',
    timestamp: '12:41:58.102 IST',
    description: 'User signed policy allowing autonomous grocery purchases up to ₹2,000/week.',
    detailLabel: 'Signer:',
    detailValue: 'vault_user_pk:0x981a3d12bf087e'
  },
  {
    stepNumber: 2,
    title: '2. Mandate Creation',
    badge: 'MND_REGISTERED',
    timestamp: '12:41:58.210 IST',
    description: 'Mandate #MND-04 locked with category MCC 5411 and ₹2,000 ceiling.',
    detailLabel: 'Constraint Digest:',
    detailValue: 'mcc:5411 | limit:2000.00 | period:7d'
  },
  {
    stepNumber: 3,
    title: '3. Agent Assignment',
    badge: 'ENCLAVE_DISPATCH',
    timestamp: '12:42:01.040 IST',
    description: 'Shopping Agent received mandate token via secure hardware enclave channel.',
    detailLabel: 'Target Agent:',
    detailValue: 'agent_id:shp-v3-902 (v2.19.1)'
  },
  {
    stepNumber: 4,
    title: '4. Delegation',
    badge: 'SUB_TOKEN_MINT',
    timestamp: '12:42:01.189 IST',
    description: 'Shopping Agent sub-delegated ₹820 one-time capability token to Payment Agent.',
    detailLabel: 'Sub-Delegation Hash:',
    detailValue: '0x6291a8e100f93012'
  },
  {
    stepNumber: 5,
    title: '5. Payment Request',
    badge: 'POS_PRESENT',
    timestamp: '12:42:02.311 IST',
    description: 'Payment Agent presented virtual cryptographic token at ABC Supermarket POS.',
    detailLabel: 'Merchant Gateway:',
    detailValue: 'Terminal ID: MID-ABC-IND-901'
  },
  {
    stepNumber: 6,
    title: '6. Risk Check',
    badge: 'ANOMALY_EVAL',
    timestamp: '12:42:02.325 IST',
    description: 'Anomaly score: 0.02. Merchant matched MCC 5411. Spend velocity within standard baseline (1.2 txn/hr).',
    detailLabel: 'Metrics:',
    detailValue: 'ANOMALY: 0.02 (SAFE) · MCC: MATCH_5411 · VELOCITY: 1.2 / hr'
  },
  {
    stepNumber: 7,
    title: '7. Decision',
    badge: 'INVARIANT_PASSED',
    timestamp: '12:42:02.329 IST',
    description: 'Decision Engine evaluated invariants: ALLOW. Policy signature verified against enclave key.',
    detailLabel: 'Rule Evaluator:',
    detailValue: 'DECISION: ALLOW (0 EXCEPTION)'
  },
  {
    stepNumber: 8,
    title: '8. Payment Settlement',
    badge: 'SETTLED',
    timestamp: '12:42:02.450 IST',
    description: '₹820 settled through banking rails. Zero human intervention needed. Ledger committed at Block #4,192,841.',
    detailLabel: 'Settlement Network Ref:',
    detailValue: 'UTR: 948291048102',
    isTerminal: true
  }
];

export const BOUND_LOGO_URL = 'https://lh3.googleusercontent.com/aida/AEtjO1WNJWogF1Mr1NIYKNJI6KlozQIr1Ccd1J-8dM5d6G3T-OSSSdEgXqI7I6NaIvpsSVu2tZiIvnuriTeRYVQ-s3G19lcTrbpsiXMwHaLyu_H0UQCpORDATaYxO04uQo4d9_VNwY4QbuzRM-7us069E_mAlRWItEnvImYXxZyG4jMmJ_KEQh203-ys0cNK_IW3K3XRFAlsJtFQpW_a9sA3jlR1pQx6m5liAvYKK7ACIwVqpC3V0-UAMGjI0aw';

export const SUPERMARKET_PHOTO_URL = 'https://lh3.googleusercontent.com/aida-public/AB6AXuChg1sF0BRPhE_CC5eS3L2it1-LAVwrc2xIKRxRAVJ3zq6stc_-KBrxjSdm_rZVASCqnukJ3h_GkPht0K8kBbtGwlWc3OFcPjrFR2-hw7wbmwObk_OXWhjEbsZ6-4ehpG-8X7rywMj7z9AU76aP9-a0qVTPw3Dq4npC8SlMFYuTfgor-IPCWvG7ofP5Iibjs5_rWNuTK8MXRUuOrRxNHlPOao1D-u6siEa-FKHKMEkS08-ET66MMgfLjA';
