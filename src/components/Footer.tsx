import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-12 border-t border-[#e2e3e8] bg-white py-6 text-[12px] text-[#76777d]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#0b1c30]">Bound</span>
          <span>·</span>
          <span>Agent payment controls</span>
        </div>
        <span>Decisions are recorded and can be reviewed in the audit log.</span>
      </div>
    </footer>
  );
};
