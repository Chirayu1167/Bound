import React, { useState } from 'react';
import { ActiveTab } from '../types';

interface SecurityViolationViewProps {
  onResolveViolation: (action: 'override' | 'revoke' | 'reject') => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const SecurityViolationView: React.FC<SecurityViolationViewProps> = ({
  onResolveViolation,
  onNavigateTab,
}) => {
  const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = (action: 'override' | 'revoke' | 'reject') => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      if (action === 'override') {
        setResolvedStatus('OVERRIDDEN: WebAuthn Biometric Signed (SecP256r1 Key Registered)');
      } else if (action === 'revoke') {
        setResolvedStatus('REVOKED: Cryptographic Keypair Severed & Downstream Tokens Invalidated');
      } else {
        setResolvedStatus('REJECTED: Incident Committed to Merkle Audit Block #4,192,842');
      }
      onResolveViolation(action);
    }, 600);
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#c6c6cd]/30">
        <div>
          <span className="font-mono text-[11px] text-[#ba1a1a] uppercase tracking-wider block mb-1 font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">gavel</span>
            Deterministic Invariant Guardrail Triggered
          </span>
          <h1 className="font-headline-xl text-[28px] sm:text-[32px] text-[#0b1c30] font-semibold tracking-tight">
            Security Verification: Policy Violation Detected
          </h1>
          <p className="font-body-md text-[14px] text-[#45464d] mt-1 max-w-2xl">
            Cryptographic Enclave Intercept &amp; Invariant Enforcement Event (Incident #INC-901844-SEC).
          </p>
        </div>

        <button
          onClick={() => onNavigateTab('overview')}
          className="px-3.5 py-1.5 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 border border-[#c6c6cd]/30 shrink-0 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Return to Feed</span>
        </button>
      </div>

      {/* Critical Status Banner */}
      <div className="p-4 rounded-xl bg-[#ffdad6] border border-[#ba1a1a]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#ba1a1a] text-[#ffffff] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">block</span>
          </div>
          <div>
            <h3 className="font-headline-sm text-[15px] font-semibold text-[#93000a]">
              SECURITY INTERCEPT ACTIVE: OUT-OF-SCOPE TRANSACTION BLOCKED
            </h3>
            <p className="text-[12px] text-[#93000a]/80">
              Transaction halted inside AWS Nitro Enclave before any funds or card tokens touched banking rails.
            </p>
          </div>
        </div>
        <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-[#ba1a1a] text-[#ffffff] font-semibold tracking-wider shrink-0 self-start sm:self-auto">
          INTERCEPT &lt;8.2ms
        </span>
      </div>

      {resolvedStatus && (
        <div className="p-4 rounded-xl bg-[#eff4ff] border border-[#009668]/50 text-[#009668] font-mono text-[12px] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span>{resolvedStatus}</span>
        </div>
      )}

      {/* Main Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Incident Breakdown & Authorization Boundary (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Incident Details Card */}
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
                Intercepted Transaction Details
              </h2>
              <span className="font-mono text-[11px] text-[#76777d]">Today, 12:37:41 IST</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 font-mono text-[12px]">
              <div>
                <span className="text-[#76777d] block text-[11px]">Merchant Destination:</span>
                <span className="font-semibold text-[#0b1c30] text-[13px]">QuickElectro Ltd</span>
                <span className="text-[#ba1a1a] block text-[11px]">
                  MCC 5732 (Consumer Electronics)
                </span>
              </div>
              <div>
                <span className="text-[#76777d] block text-[11px]">Attempted Charge:</span>
                <span className="font-semibold text-[#ba1a1a] text-[16px]">₹3,500.00 INR</span>
                <span className="text-[#76777d] block text-[11px]">Authorized Cap: ₹2,000</span>
              </div>
              <div>
                <span className="text-[#76777d] block text-[11px]">Calling Runtime:</span>
                <span className="text-[#0b1c30]">Payment Agent (agt_09v4c1k9qa)</span>
              </div>
              <div>
                <span className="text-[#76777d] block text-[11px]">Parent Delegator:</span>
                <span className="text-[#0b1c30]">Shopping Agent (agt_01h8x9p3km)</span>
              </div>
            </div>
          </div>

          {/* Authorization Boundary Breakdown */}
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Authorization Boundary Invariant Failures
            </h2>

            <div className="space-y-3">
              {/* Failure 1 */}
              <div className="p-4 rounded-xl bg-[#ffdad6]/40 border border-[#ba1a1a]/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-[14px] font-semibold text-[#93000a]">
                    1. Merchant Category Code (MCC) Isolation Breach
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#ba1a1a] text-[#ffffff] font-semibold">
                    VIOLATION
                  </span>
                </div>
                <p className="text-[12px] text-[#45464d]">
                  Mandate #MND-4091 strictly whitelists <strong className="text-[#0b1c30]">MCC 5411 (Grocery Stores)</strong>. The agent presented a token at an electronics vendor (MCC 5732). Hardware sandbox prevented token derivation.
                </p>
              </div>

              {/* Failure 2 */}
              <div className="p-4 rounded-xl bg-[#ffdad6]/40 border border-[#ba1a1a]/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-[14px] font-semibold text-[#93000a]">
                    2. Mandate Budget Cap Exceeded (+₹2,960 Over Limit)
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#ba1a1a] text-[#ffffff] font-semibold">
                    VIOLATION
                  </span>
                </div>
                <p className="text-[12px] text-[#45464d]">
                  Remaining mandate buffer is <strong className="text-[#0b1c30]">₹540</strong>. Attempted charge of ₹3,500 exceeds headroom by ₹2,960. Enclave enforced zero-overdraft invariant.
                </p>
              </div>

              {/* Check 3 */}
              <div className="p-4 rounded-xl bg-[#eff4ff]/60 border border-[#c6c6cd]/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-[14px] font-semibold text-[#0b1c30]">
                    3. Privilege Escalation Prevention
                  </span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#eff4ff] text-[#009668] font-semibold">
                    CONTAINED
                  </span>
                </div>
                <p className="text-[12px] text-[#45464d]">
                  The child agent attempted to expand its parent scope. Sub-tokens cannot exceed parent authority bounds under cryptographic construction.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Actions & Enclave Seal (1 col) */}
        <div className="space-y-6">
          {/* Containment Resolution Panel */}
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-4">
            <h2 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Principal Remediation
            </h2>
            <p className="text-[12px] text-[#45464d]">
              Select an action as the Root Vault Principal:
            </p>

            <div className="space-y-2.5">
              <button
                disabled={isProcessing}
                onClick={() => handleAction('revoke')}
                className="w-full p-3 rounded-lg bg-[#ba1a1a] text-[#ffffff] text-[12px] font-medium hover:opacity-95 transition-opacity cursor-pointer text-left flex items-start gap-2.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                  gavel
                </span>
                <div>
                  <span className="font-semibold block">Sever &amp; Revoke Agent Keypair</span>
                  <span className="text-[11px] opacity-80 block">
                    Immediately destroys signing authority for Payment Agent.
                  </span>
                </div>
              </button>

              <button
                disabled={isProcessing}
                onClick={() => handleAction('override')}
                className="w-full p-3 rounded-lg bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer text-left flex items-start gap-2.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                  fingerprint
                </span>
                <div>
                  <span className="font-semibold block">One-Time WebAuthn Override</span>
                  <span className="text-[11px] opacity-80 block">
                    Authorize ₹3,500 once with your biometric hardware token.
                  </span>
                </div>
              </button>

              <button
                disabled={isProcessing}
                onClick={() => handleAction('reject')}
                className="w-full p-3 rounded-lg bg-[#eff4ff] hover:bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium transition-colors cursor-pointer text-left flex items-start gap-2.5 border border-[#c6c6cd]/30"
              >
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5 text-[#76777d]">
                  archive
                </span>
                <div>
                  <span className="font-semibold block">Commit Rejection to Audit Log</span>
                  <span className="text-[11px] text-[#76777d] block">
                    Preserve intercept evidence and close alert.
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Enclave Hardware Attestation Seal */}
          <div className="p-6 rounded-xl bg-[#ffffff] border border-[#c6c6cd]/30 shadow-xs space-y-3 font-mono text-[11px]">
            <div className="flex items-center justify-between text-[#0b1c30]">
              <span className="font-semibold">Hardware Proof Seal</span>
              <span className="text-[#009668] flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                Nitro Isolated
              </span>
            </div>
            <div className="p-3 rounded bg-[#eff4ff] space-y-1.5 text-[#45464d] border border-[#c6c6cd]/25">
              <div>
                <span className="text-[#76777d] block text-[10px]">Intercept Digest:</span>
                <span className="text-[#0b1c30] break-all">
                  0xbc89421f00a283e1088710ae
                </span>
              </div>
              <div>
                <span className="text-[#76777d] block text-[10px]">Consensus Quorum:</span>
                <span className="text-[#009668] font-semibold">3 of 3 Enclaves Blocked</span>
              </div>
              <div>
                <span className="text-[#76777d] block text-[10px]">Settlement Breach Risk:</span>
                <span className="text-[#009668] font-semibold">0.00% (Containment Guaranteed)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
