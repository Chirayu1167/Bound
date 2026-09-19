import React from 'react';
import { DOMAINS } from '../domains';
import { usualSpendRange, formatUsualSpend } from '../preferences';
import type { TransactionRecord } from '../types';
import { EmptyState } from '../components/ui';

interface PreferencesViewProps {
  transactions: TransactionRecord[];
}

/**
 * Preferences — Phase 1 scaffolding.
 *
 * Shows ONLY what is real today: usual-spend ranges derived from recorded
 * APPROVED transactions. Saved preferences (diet, favorites, addresses) do
 * not exist yet — the empty states say so explicitly instead of inventing
 * them. Full editing arrives in Phase 2 with a user-owned preference store.
 *
 * Invariant, stated in the UI: preferences inform behavior and risk
 * detection; they never grant permission.
 */
export const PreferencesView: React.FC<PreferencesViewProps> = ({ transactions }) => {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[#0b1c30] tracking-tight">Preferences</h1>
        <p className="text-[13px] text-[#5a5c63] mt-1 max-w-xl">
          What Bound knows about your habits — used to spot unusual activity.
          Preferences never grant permission: only your spending rules do.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DOMAINS.map((d) => {
          const usual = usualSpendRange(transactions, d.categories);
          return (
            <div key={d.id} className="rounded-xl bg-white border border-[#e2e3e8] p-4">
              <p className="text-[14px] font-semibold text-[#0b1c30]">
                {d.icon} {d.label}
              </p>
              <p className="text-[13px] text-[#0b1c30] mt-2">
                Usual spend:{' '}
                {usual ? (
                  <span className="font-medium">
                    {formatUsualSpend(usual)} <span className="font-normal text-[#76777d]">({usual.count} approved payments)</span>
                  </span>
                ) : (
                  <span className="text-[#76777d]">Not enough history yet</span>
                )}
              </p>
              <p className="text-[12px] text-[#76777d] mt-1">Saved favorites, diet, addresses: none yet — Phase 2.</p>
            </div>
          );
        })}
      </div>

      <EmptyState
        title="Full preferences arrive in Phase 2"
        body="Vegetarian, favorite restaurants, usual ranges, preferred airline, delivery addresses — stored per user, editable here, and used only for behavior context and risk signals. They will never raise a spending limit."
      />
    </div>
  );
};
