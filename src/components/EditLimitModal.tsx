import React, { useEffect, useState } from 'react';
import { MandateItem } from '../types';
import { Modal, inputClass, labelClass } from './ui';

interface EditLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  mandate: MandateItem | null;
  onSave: (id: string, newCap: number) => Promise<void>;
}

export const EditLimitModal: React.FC<EditLimitModalProps> = ({ isOpen, onClose, mandate, onSave }) => {
  const [value, setValue] = useState(mandate ? String(mandate.max_amount) : '2000');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mandate) setValue(String(mandate.max_amount));
    setError(null);
  }, [mandate]);

  if (!isOpen || !mandate) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cap = parseFloat(value);
    if (!cap || cap <= 0) {
      setError('Enter a limit greater than zero.');
      return;
    }
    setSaving(true);
    try {
      await onSave(mandate.id, cap);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update the limit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">Edit limit — {mandate.purpose}</h3>
      <p className="text-[13px] text-[#5a5c63] mt-1">Current limit: ₹{mandate.max_amount.toLocaleString()} for {mandate.agentName}.</p>
      {error && <p className="mt-3 text-[13px] text-[#93000a] bg-[#fdf3f2] border border-[#e8c4c0] rounded-lg px-3 py-2">{error}</p>}
      <form onSubmit={submit} className="space-y-3.5 mt-4">
        <div>
          <label className={labelClass()}>New limit (₹)</label>
          <input type="number" min="1" step="any" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass()} mt-1`} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#0b1c30] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
            {saving ? 'Saving…' : 'Save limit'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
