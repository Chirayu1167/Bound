import React, { useEffect, useState } from 'react';

interface AskBarProps {
  onAsk: (text: string) => void;
  /** External preset (e.g. demo scenario). Applied when nonce changes. */
  preset?: { text: string; nonce: number } | null;
}

export const AskBar: React.FC<AskBarProps> = ({ onAsk, preset }) => {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (preset && preset.nonce > 0) setValue(preset.text);
  }, [preset]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    onAsk(text);
    setValue('');
  };

  return (
    <div className="rounded-xl bg-white border border-[#e2e3e8] p-5">
      <h1 className="text-[20px] font-semibold text-[#0b1c30] tracking-tight">What would you like me to take care of?</h1>
      <form onSubmit={submit} className="mt-3 flex flex-col sm:flex-row gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Order me dinner under ₹800"
          aria-label="Describe what you want done"
          className="flex-1 min-w-0 px-4 py-3 rounded-xl text-[14px] text-[#0b1c30] bg-[#f7f8fb] border border-[#e2e3e8] outline-none focus:border-[#0051d5] focus:bg-white placeholder:text-[#9a9ba1]"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-5 py-3 rounded-xl bg-[#0b1c30] text-white text-[14px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-40 shrink-0"
        >
          Go →
        </button>
      </form>
      <p className="text-[12px] text-[#76777d] mt-2">
        Try “Order me dinner under ₹800”, “Book a flight to Delhi under ₹12,000”, or “Order my usual dinner”.
      </p>
    </div>
  );
};
