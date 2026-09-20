import React from 'react';
import { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  backendLive: boolean | null;
}

const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'agents', label: 'Agents' },
  { id: 'apps', label: 'Apps' },
  { id: 'orders', label: 'Orders & Trips' },
  { id: 'activity', label: 'Activity' },
  { id: 'audit', label: 'Audit' },
  { id: 'preferences', label: 'Preferences' },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange, backendLive }) => {
  return (
    <header className="fixed top-0 left-0 w-full z-40 bg-white border-b border-[#e2e3e8]">
      <div className="h-14 w-full max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => onTabChange('home')} className="flex items-center gap-2 cursor-pointer">
            <span className="w-7 h-7 rounded-lg bg-[#0b1c30] text-white flex items-center justify-center text-[14px] font-semibold">B</span>
            <span className="text-[15px] text-[#0b1c30] font-semibold tracking-tight">Bound</span>
          </button>
          <span
            title={backendLive === null ? 'Checking backend…' : backendLive ? 'Backend reachable' : 'Backend unreachable'}
            className={`hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] border ${
              backendLive === false
                ? 'bg-[#fdecea] text-[#93000a] border-[#ba1a1a]/25'
                : backendLive === true
                  ? 'bg-[#e6f4ee] text-[#0a6b4a] border-[#0a6b4a]/20'
                  : 'bg-[#f2f2f4] text-[#5a5c63] border-[#e2e3e8]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${backendLive === false ? 'bg-[#ba1a1a]' : backendLive === true ? 'bg-[#0a6b4a]' : 'bg-[#9a9ba1]'}`} />
            {backendLive === null ? 'Connecting…' : backendLive ? 'Connected' : 'Offline'}
          </span>
        </div>

        <nav className="flex items-center gap-1 p-1 rounded-lg bg-[#f2f3f6]" aria-label="Primary">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`px-3 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer ${
                activeTab === t.id ? 'bg-white text-[#0b1c30] font-semibold shadow-sm' : 'text-[#5a5c63] hover:text-[#0b1c30]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
