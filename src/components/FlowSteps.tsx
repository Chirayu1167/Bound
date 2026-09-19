import React from 'react';

export type FlowStage = 'request' | 'check' | 'payment' | 'result';

const STAGES: Array<{ id: FlowStage; label: string }> = [
  { id: 'request', label: 'Request' },
  { id: 'check', label: 'Bound check' },
  { id: 'payment', label: 'Payment' },
  { id: 'result', label: 'Result' },
];

/** Compact macro-flow indicator: Request → Bound check → Payment → Result. */
export const FlowSteps: React.FC<{ stage: FlowStage }> = ({ stage }) => {
  const activeIdx = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="flex items-center gap-1.5 px-1" aria-label="Demo progress">
      {STAGES.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${
                i < activeIdx
                  ? 'bg-[#e6f4ee] text-[#0a6b4a]'
                  : i === activeIdx
                    ? 'bg-[#0b1c30] text-white'
                    : 'bg-[#eef1f6] text-[#9a9ba1]'
              }`}
            >
              {i < activeIdx ? '✓' : i + 1}
            </span>
            <span className={`text-[12px] ${i === activeIdx ? 'font-semibold text-[#0b1c30]' : 'text-[#76777d]'}`}>
              {s.label}
            </span>
          </div>
          {i < STAGES.length - 1 && <span className="flex-1 h-px bg-[#e2e3e8] min-w-3" />}
        </React.Fragment>
      ))}
    </div>
  );
};
