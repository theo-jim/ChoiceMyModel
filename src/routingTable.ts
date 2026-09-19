import type {
  AgentKind,
  Classification,
  ReasoningEffort,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  Tier,
  UseCase,
  WorkerChoice,
} from "./types.js";

interface RosterEntry {
  model: string;
  effort?: ReasoningEffort;
}

/**
 * One roster per agent kind, so the routing table stays vendor-independent:
 * what the evals teach you ("a lookup holds its score on the light tier") is a
 * fact about the task class, not about a vendor.
 *
 * Codex effort levels follow herd's own guidance: Luna at low for bulk
 * mechanical work, Terra at high for ordinary coding, Sol at xhigh reserved for
 * genuinely hard problems. Claude Code has no reasoning-effort flag.
 */
export const ROSTERS: Record<AgentKind, Record<Tier, RosterEntry>> = {
  claude: {
    light: { model: "claude-haiku-4-5" },
    mid: { model: "claude-sonnet-5" },
    frontier: { model: "claude-opus-5" },
  },
  codex: {
    light: { model: "gpt-5.6-luna", effort: "low" },
    mid: { model: "gpt-5.6-terra", effort: "high" },
    frontier: { model: "gpt-5.6-sol", effort: "xhigh" },
  },
};

const TIER_ORDER: Tier[] = ["light", "mid", "frontier"];

/**
 * Starter table only. The whole point of the Jev/Cortex pattern is that this
 * mapping is the OUTPUT of per-use-case evals against your own traffic, not a
 * guess — see src/evals/. Replace these defaults once you have real scores.
 */
export const DEFAULT_ROUTING_TABLE: RoutingTable = {
  lookup: "light",
  docs: "light",
  chore: "light",
  review: "mid",
  debug: "mid",
  implement: "mid",
  refactor: "mid",
  test: "mid",
  other: "mid",
};

/**
 * Thresholds are where risk tolerance lives. A confidence threshold is not one
 * number: a class whose mistakes are expensive has to clear a higher bar before
 * the cheap tier is trusted.
 */
export const DEFAULT_THRESHOLDS: RoutingThresholds = {
  noul: 0.7,
  minUseCaseConfidence: 0.5,
  useCaseConfidenceFloors: {
    implement: 0.75,
    debug: 0.6,
    refactor: 0.6,
  },
};

function escalate(tier: Tier): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

function deescalate(tier: Tier): Tier {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(tier) - 1, 0)];
}

/**
 * Renders herd-spawn's -a value. For claude the permission flag has to be
 * re-included because passing -a replaces herd's default entirely.
 *
 * Least privilege applies to both vendors: a task the classifier says needs no
 * writes gets a read-only worker. For claude that is herd's `plan` permission
 * mode (analyse only, no edits); for codex it is the `read-only` sandbox.
 */
export function renderWorker(kind: AgentKind, tier: Tier, needsWrite: boolean): WorkerChoice {
  const entry = ROSTERS[kind][tier];

  if (kind === "claude") {
    const permissionMode = needsWrite ? "acceptEdits" : "plan";
    return {
      kind,
      model: entry.model,
      args: `--model ${entry.model} --permission-mode ${permissionMode}`,
    };
  }

  const sandbox = needsWrite ? "workspace-write" : "read-only";
  return {
    kind,
    model: entry.model,
    effort: entry.effort,
    args: `-m ${entry.model} -c model_reasoning_effort=${entry.effort} --sandbox ${sandbox}`,
  };
}

export interface RouteOptions {
  kind?: AgentKind;
  table?: RoutingTable;
  thresholds?: RoutingThresholds;
}

/**
 * Pure lookup: task class -> cheapest tier that should hold the bar, bumped one
 * tier when a signal changes the cost of being wrong, or when the classifier
 * itself is not confident which class this is. An unsure classification
 * escalating is deliberate: a cheap guess on an unrecognized task is the
 * expensive kind of mistake.
 */
export function route(classification: Classification, options: RouteOptions = {}): RoutingDecision {
  const kind = options.kind ?? "claude";
  const table = options.table ?? DEFAULT_ROUTING_TABLE;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const { useCase } = classification;
  const baseTier = table[useCase] ?? "mid";
  const isYes = (noul: number) => noul >= thresholds.noul;

  const reasons: string[] = [];
  if (isYes(classification.hardToReverse)) reasons.push("hard to reverse if wrong");
  if (isYes(classification.spansMultipleSystems)) reasons.push("spans 4+ systems");
  if (isYes(classification.craftIsMainDifficulty)) reasons.push("design judgment is the main difficulty");

  const confidenceFloor =
    thresholds.useCaseConfidenceFloors?.[useCase] ?? thresholds.minUseCaseConfidence;
  if (classification.useCaseConfidence < confidenceFloor) {
    reasons.push("classifier unsure which task class this is");
  }

  // Speculative answer, read only on the branches it was asked for, and only
  // once nothing risky has fired: bulk AND hard-to-reverse is the most
  // dangerous combination, not a reason to go cheaper.
  const bulkMechanical =
    (useCase === "chore" || useCase === "refactor") && isYes(classification.isBulkMechanical);

  let tier = baseTier;
  if (reasons.length > 0) {
    tier = escalate(baseTier);
  } else if (bulkMechanical) {
    tier = deescalate(baseTier);
    if (tier !== baseTier) reasons.push("bulk mechanical work, dropped a tier");
  }

  return {
    tier,
    worker: renderWorker(kind, tier, isYes(classification.needsWriteAccess)),
    classification,
    escalated: TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(baseTier),
    reasons,
  };
}

export function loadRoutingTable(overrides: Partial<RoutingTable>): RoutingTable {
  return { ...DEFAULT_ROUTING_TABLE, ...overrides };
}

export type { UseCase };
