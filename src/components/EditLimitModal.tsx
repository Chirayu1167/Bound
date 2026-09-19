import React, { useState } from 'react';
import { MandateItem } from '../types';

interface EditLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  mandate: MandateItem | null;
  onSaveLimit: (id: string, newCap: number) => void;
}

export const EditLimitModal: React.FC<EditLimitModalProps> = ({
  isOpen,
  onClose,
  mandate,
  onSaveLimit,
}) => {
  const [newCap, setNewCap] = useState(mandate?.cap.toString() || '2000');

  React.useEffect(() => {
    if (mandate) {
      setNewCap(mandate.cap.toString());
    }
  }, [mandate]);

  if (!isOpen || !mandate) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const capNum = parseFloat(newCap);
    if (!isNaN(capNum) && capNum > 0) {
      onSaveLimit(mandate.id, capNum);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-xl bg-[#ffffff] shadow-2xl p-6 space-y-4 border border-[#c6c6cd]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#0051d5] text-[20px]">
              tune
            </span>
            <h3 className="font-headline-md text-[18px] text-[#0b1c30] font-semibold">
              Edit Spending Limit: {mandate.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#45464d] hover:text-[#0b1c30] cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-[12px] text-[#45464d]">
          Current utilization: ₹{mandate.spent.toLocaleString()} / ₹{mandate.cap.toLocaleString()} ({Math.round((mandate.spent / mandate.cap) * 100)}%).
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#0b1c30] font-medium">
              New Authorized Cap (INR)
            </label>
            <input
              type="number"
              value={newCap}
              onChange={(e) => setNewCap(e.target.value)}
              min={mandate.spent}
              required
              className="px-3 py-2 bg-[#eff4ff] rounded font-mono text-[14px] text-[#0b1c30] outline-none border border-[#c6c6cd]/40 focus:border-[#0051d5] focus:bg-[#ffffff]"
            />
            {parseFloat(newCap) < mandate.spent && (
              <span className="text-[11px] text-[#ba1a1a]">
                New cap cannot be lower than current spent amount (₹{mandate.spent})
              </span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#c6c6cd]/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-[12px] font-medium text-[#0b1c30] hover:bg-[#e5eeff] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded text-[12px] font-medium bg-[#000000] text-[#ffffff] hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
            >
              Update Mandate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
