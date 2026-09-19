import React, { useState } from 'react';

interface ProofModalProps {
  isOpen: boolean;
  onClose: () => void;
  txId?: string;
  agent?: string;
  merchant?: string;
  amount?: string;
  status?: string;
}

export const ProofModal: React.FC<ProofModalProps> = ({
  isOpen,
  onClose,
  txId = 'tx_901923',
  agent = 'Shopping Agent',
  merchant = 'ABC Supermarket',
  amount = '₹820',
  status = 'ALLOWED',
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const rawJson = JSON.stringify(
    {
      tx_id: txId,
      agent: agent,
      merchant: merchant,
      amount: amount,
      status: status,
      enclave_quorum: '3/3 verified',
      signatures: {
        root_kms: '0x88f29ab01289123e41b001a91',
        agent_delegation: '0x14bc8a129930199ca108f921a',
        enclave_attestation: '0x6e8a0021fa217dd1029813c9a',
      },
      timestamp_epoch: 1740871290,
      nitro_pcr0: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    null,
    2
  );

  const handleCopy = () => {
    navigator.clipboard?.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/50 p-4 animate-in fade-in">
      <div className="w-full max-w-lg rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-5 border border-[#c6c6cd]/30">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-mono text-[11px] text-[#76777d] uppercase tracking-wider">
              Zero-Knowledge Verification
            </span>
            <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold mt-0.5">
              Execution Attestation Proof
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#e5eeff] text-[#76777d] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-3 font-mono text-[11px]">
          <div className="p-3 rounded bg-[#eff4ff] space-y-1.5 border border-[#c6c6cd]/20">
            <div className="flex justify-between">
              <span className="text-[#76777d]">Tx ID:</span>{' '}
              <span className="text-[#0b1c30]">{txId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#76777d]">Agent:</span>{' '}
              <span className="text-[#0b1c30] font-semibold">{agent}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#76777d]">Merchant:</span>{' '}
              <span className="text-[#0b1c30]">{merchant}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#76777d]">Amount:</span>{' '}
              <span className="text-[#0b1c30] font-semibold">{amount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#76777d]">Enclave Status:</span>{' '}
              <span
                className={`font-semibold ${
                  status === 'ALLOWED' ? 'text-[#009668]' : 'text-[#ba1a1a]'
                }`}
              >
                {status}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[#76777d] block">Enclave Chain Signatures:</span>
            <div className="p-2.5 rounded bg-[#e5eeff] text-[#45464d] break-all text-[11px] leading-relaxed border border-[#c6c6cd]/30">
              0x88f29ab012...3e41b (Acme Root KMS)
              <br />
              └── 0x14bc8a1299...99ca1 ({agent})
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;└── 0x6e8a0021fa...dd102 (Bound Secure Enclave)
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[#c6c6cd]/20">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium hover:bg-[#dce9ff] transition-colors cursor-pointer"
          >
            Dismiss
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 rounded bg-[#000000] text-[#ffffff] text-[12px] font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[14px]">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span>{copied ? 'Copied Raw JSON' : 'Copy Raw Enclave JSON'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
