import React, { useState } from 'react';
import { Modal, inputClass, labelClass } from './ui';

interface RegisterAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: { name: string; description?: string }) => Promise<void>;
}

export const RegisterAgentModal: React.FC<RegisterAgentModalProps> = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the agent a name.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not register the agent.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="text-[16px] font-semibold text-[#0b1c30]">New agent</h3>
      <p className="text-[13px] text-[#5a5c63] mt-1">Agents can only spend within a rule you create afterwards.</p>
      {error && <p className="mt-3 text-[13px] text-[#93000a] bg-[#fdf3f2] border border-[#e8c4c0] rounded-lg px-3 py-2">{error}</p>}
      <form onSubmit={submit} className="space-y-3.5 mt-4">
        <div>
          <label className={labelClass()}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shopping Agent" className={`${inputClass()} mt-1`} />
        </div>
        <div>
          <label className={labelClass()}>Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" className={`${inputClass()} mt-1`} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#0b1c30] bg-[#eef1f6] hover:bg-[#e2e7f0] cursor-pointer disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#0b1c30] text-white hover:opacity-90 cursor-pointer disabled:opacity-60">
            {submitting ? 'Creating…' : 'Create agent'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
