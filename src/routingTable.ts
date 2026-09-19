import type {
  Classification,
  ModelTier,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  UseCase,
} from "./types.js";

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

/**
 * Thresholds are where risk tolerance lives. TypeSafe's guidance is to gate
 * different actions at different levels rather than pick one global number, so
 * tune these per deployment once you can plot confidence against accuracy.
 *
 * The per-class floors say: misreading a task that writes state is the costly
 * mistake, so automation has to clear a higher bar than a lookup before the
 * cheap tier is trusted.
 */
export const DEFAULT_THRESHOLDS: RoutingThresholds = {
  noul: 0.7,
  minUseCaseConfidence: 0.5,
  useCaseConfidenceFloors: {
    automation: 0.75,
    investigation: 0.6,
    deliverable: 0.6,
  },
};

function escalate(tier: ModelTier): ModelTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

/**
 * Pure lookup: use-case class -> cheapest tier that should hold the bar, bumped
 * one tier when a signal changes the cost of being wrong, or when the
 * classifier itself is not confident which class this is. An unsure
 * classification escalating is deliberate: a cheap guess on an unrecognized
 * task is the expensive kind of mistake.
 */
export function route(
  classification: Classification,
  table: RoutingTable = DEFAULT_ROUTING_TABLE,
  thresholds: RoutingThresholds = DEFAULT_THRESHOLDS,
): RoutingDecision {
  const { useCase } = classification;
  const baseTier = table[useCase] ?? "sonnet";
  const isYes = (noul: number) => noul >= thresholds.noul;

  const reasons: string[] = [];
  if (isYes(classification.hardToReverse)) reasons.push("hard to reverse if wrong");
  if (isYes(classification.spansMultipleSystems)) reasons.push("spans 4+ systems");
  if (isYes(classification.craftIsMainDifficulty)) reasons.push("craft is the main difficulty");

  // Speculative answers, read only on the branch each one was asked for.
  if (useCase === "automation" && isYes(classification.isBulkOperation)) {
    reasons.push("acts on many records at once");
  }
  if (
    (useCase === "communication" || useCase === "deliverable") &&
    isYes(classification.isClientFacing)
  ) {
    reasons.push("client-facing output");
  }

  const confidenceFloor = thresholds.useCaseConfidenceFloors?.[useCase] ?? thresholds.minUseCaseConfidence;
  if (classification.useCaseConfidence < confidenceFloor) {
    reasons.push("classifier unsure which use case this is");
  }

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
