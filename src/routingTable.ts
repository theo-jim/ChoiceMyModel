import type { Classification, ModelTier, RoutingDecision, RoutingTable, UseCase } from "./types.js";

export const MODEL_IDS: Record<ModelTier, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

const TIER_ORDER: ModelTier[] = ["haiku", "sonnet", "opus"];

/**
 * Starter table only. The whole point of the Jev/Cortex pattern is that this
 * mapping is the OUTPUT of per-use-case evals against your own traffic, not a
 * guess — see src/evals/. Replace these defaults once you have real scores.
 */
export const DEFAULT_ROUTING_TABLE: RoutingTable = {
  lookup: "haiku",
  summarization: "haiku",
  communication: "haiku",
  analytics: "sonnet",
  investigation: "sonnet",
  deliverable: "sonnet",
  automation: "sonnet",
  other: "sonnet",
};

function escalate(tier: ModelTier): ModelTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

/**
 * Pure lookup: use-case class -> cheapest tier that should hold the bar,
 * bumped one tier when the classifier flagged a reason that changes the
 * cost of being wrong (irreversible, spans many systems, or needs polish).
 */
export function route(classification: Classification, table: RoutingTable = DEFAULT_ROUTING_TABLE): RoutingDecision {
  const baseTier = table[classification.useCase] ?? "sonnet";

  const reasons: string[] = [];
  if (classification.hardToReverse) reasons.push("hard to reverse if wrong");
  if (classification.spansMultipleSystems) reasons.push("spans 4+ systems");
  if (classification.craftIsMainDifficulty) reasons.push("craft is the main difficulty");

  const tier = reasons.length > 0 ? escalate(baseTier) : baseTier;

  return {
    tier,
    model: MODEL_IDS[tier],
    classification,
    escalated: tier !== baseTier,
    reasons,
  };
}

export function loadRoutingTable(overrides: Partial<RoutingTable>): RoutingTable {
  return { ...DEFAULT_ROUTING_TABLE, ...overrides };
}

export type { UseCase };
