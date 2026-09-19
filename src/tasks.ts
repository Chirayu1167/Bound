/**
 * Bound — Task concept (Phase 1 product shell).
 *
 * A task represents ONE user request handled by a persistent domain agent:
 *
 *   Food Agent → Dinner task → Budget ₹800 → completes / expires
 *
 * The invariant is: TASK AUTHORITY ⊆ DOMAIN AGENT AUTHORITY.
 *
 * PHASE 1 SCOPE (deliberate): tasks are TRANSIENT UI drafts held in memory.
 * They are derived from the user's words (intent) + real backend data
 * (resolved agent + standing mandate) and their only path to a decision is
 * the existing backend authorization engine. There is deliberately NO
 * backend task entity yet — persisting tasks without execution, approvals,
 * and expiry machinery would be dead/fake state.
 *
 * Nothing here grants authority. The task budget is a display of what the
 * user asked for; the backend engine alone decides Approved / Needs Review.
 *
 * PHASE 2 (documented, not built): backend `tasks` table
 * (id, user_request, domain, agent_id, budget, merchant, status,
 *  expires_at), auto-created ephemeral delegations (domain → task),
 *  approvals table for one-time overrides, TTL enforcement.
 */

import type { DomainId } from './domains';

export interface TaskDraft {
  /** Client-side id, e.g. "task-171...". Never sent as authority. */
  id: string;
  domainId: DomainId;
  purpose: string;
  /** Maximum the user stated, in INR. Null = not stated. */
  budget: number | null;
  /** Resolved real backend agent, if a standing rule exists. */
  agentId: string | null;
  /** Resolved real standing mandate, if one exists. */
  mandateId: string | null;
  createdAt: number;
}

let taskCounter = 0;

export function createTaskDraft(
  domainId: DomainId,
  purpose: string,
  budget: number | null,
  agentId: string | null,
  mandateId: string | null
): TaskDraft {
  taskCounter += 1;
  return {
    id: `task-${Date.now()}-${taskCounter}`,
    domainId,
    purpose,
    budget,
    agentId,
    mandateId,
    createdAt: Date.now(),
  };
}
