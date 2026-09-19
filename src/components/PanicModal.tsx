import React from 'react';

interface PanicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const PanicModal: React.FC<PanicModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-4 border border-[#c6c6cd]/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#ffdad6] text-[#93000a] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">gavel</span>
          </div>
          <div>
            <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Panic Revoke All
            </h3>
            <p className="font-body-sm text-[12px] text-[#76777d]">
              Sever all delegated cryptographic authority.
            </p>
          </div>
        </div>
        <p className="font-body-md text-[13px] text-[#45464d] leading-relaxed">
          This will immediately revoke <strong className="text-[#0b1c30]">all active credentials</strong> across all registered agents. Running tasks will halt and any outbound transaction attempts will be strictly denied by the Bound Enclave in &lt;10ms.
        </p>
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#c6c6cd]/20">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded bg-[#e5eeff] text-[#0b1c30] text-[12px] font-medium hover:bg-[#dce9ff] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded bg-[#ba1a1a] text-[#ffffff] text-[12px] font-medium hover:opacity-90 shadow-sm transition-opacity cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            <span>Confirm Emergency Revoke</span>
          </button>
        </div>
      </div>
    </div>
  );
};
