import React from 'react';
import { ActiveTab } from '../types';
import { BOUND_LOGO_URL } from '../data/mockData';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onOpenCommandPalette: () => void;
  panicSevered?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenCommandPalette,
  panicSevered
}) => {
  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-[#ffffff] border-b border-[#c6c6cd]/30 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-14 w-full px-6 flex items-center justify-between gap-3">
        {/* Left: Brand & Status */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onTabChange('overview')}
            className="flex items-center gap-1 cursor-pointer focus:outline-none"
          >
            <img
              alt="Bound Logo"
              className="h-8 w-auto object-contain"
              src={BOUND_LOGO_URL}
            />
            <span className="font-headline-sm text-[15px] text-[#0b1c30] font-semibold tracking-tight ml-1">
              Bound
            </span>
          </button>
          <div className="h-4 w-px bg-[#c6c6cd]/60"></div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#eff4ff] border border-[#c6c6cd]/40">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  panicSevered ? 'bg-[#ba1a1a]' : 'bg-[#009668]'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  panicSevered ? 'bg-[#ba1a1a]' : 'bg-[#009668]'
                }`}
              ></span>
            </span>
            <span className="font-mono text-[11px] text-[#45464d] uppercase tracking-wide">
              {panicSevered ? 'Emergency · Severed' : 'Production · Enforcing'}
            </span>
          </div>
        </div>

        {/* Center: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1 p-1 rounded-lg bg-[#e5eeff]/50 border border-[#c6c6cd]/30">
          <button
            onClick={() => onTabChange('overview')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => onTabChange('agents')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'agents'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Agents
          </button>
          <button
            onClick={() => onTabChange('mandates')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'mandates'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Mandates
          </button>
          <button
            onClick={() => onTabChange('delegations')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'delegations'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Delegations
          </button>
          <button
            onClick={() => onTabChange('transactions')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'transactions'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Transactions
          </button>
          <button
            onClick={() => onTabChange('security')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'security'
                ? 'bg-[#eff4ff] text-[#0b1c30] font-semibold shadow-sm'
                : 'text-[12px] text-[#45464d] hover:text-[#0b1c30] hover:bg-[#eff4ff]'
            }`}
          >
            Security
          </button>
        </nav>

        {/* Right: Telemetry & Vault */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            onClick={() => onTabChange('security')}
            className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#e5eeff] border border-[#c6c6cd]/40 font-mono text-[11px] text-[#0b1c30] cursor-pointer hover:bg-[#dce9ff] transition-colors"
          >
            <span className="material-symbols-outlined text-[#009668] text-[14px]">
              verified_user
            </span>
            <span>All Guards Active · 0 Breaches</span>
          </div>

          <button
            onClick={onOpenCommandPalette}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#eff4ff] border border-[#c6c6cd]/40 hover:bg-[#e5eeff] cursor-pointer transition-colors text-[#45464d]"
          >
            <span className="material-symbols-outlined text-[16px]">search</span>
            <span className="text-[12px] hidden sm:inline">Filter</span>
            <kbd className="px-1.5 py-0.5 rounded bg-[#ffffff] border border-[#c6c6cd]/40 font-mono text-[11px] text-[#45464d]">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-[#c6c6cd]/40">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-[11px] text-[#0b1c30] font-medium leading-none">
                Acme Systems
              </span>
              <span className="font-mono text-[11px] text-[#45464d] leading-none mt-1">
                Vault #1
              </span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#000000] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#ffffff] text-[18px]">
                person
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
