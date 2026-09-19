import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-16 border-t border-[#c6c6cd]/30 bg-[#ffffff] py-8 text-[12px] text-[#76777d]">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-2 text-center sm:text-left">
          <span className="font-semibold text-[#0b1c30]">Bound</span>
          <span className="hidden sm:inline">·</span>
          <span>Agent Authorization Engine v2.4.19</span>
          <span className="hidden sm:inline">·</span>
          <span>Cryptographic Multi-Party Enclave · Zero-Latency Isolation</span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-[#009668]">
            <span className="w-2 h-2 rounded-full bg-[#009668]"></span>
            <span>All Guards Enforcing</span>
          </span>
          <span className="text-[#c6c6cd]">|</span>
          <span className="text-[#45464d]">Nitro PCR0: Validated</span>
        </div>
      </div>
    </footer>
  );
};
