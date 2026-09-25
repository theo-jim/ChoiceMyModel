import type {
  AgentKind,
  Classification,
  ExecutionScope,
  ReasoningDemand,
  ReasoningEffort,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  Tier,
  UseCase,
  WorkerChoice,
} from "./types.js";

interface RosterEntry {
  /**
   * For claude: a bare --model alias ("haiku"/"sonnet"/"opus") the claude CLI
   * resolves itself. For codex: the tier suffix ("luna"/"terra"/"sol"); the
   * version prefix in front of it is resolved at runtime by
   * resolveCodexModel() (see codexModel.ts), never hardcoded here.
   */
  model: string;
}

/**
 * One roster per agent kind, so the routing table stays vendor-independent:
 * what the evals teach you ("a lookup holds its score on the light tier") is a
 * fact about the task class, not about a vendor. The roster only picks the
 * model; codex's reasoning effort is a separate decision (selectReasoningEffort
 * below), decoupled from tier on purpose.
 */
export const ROSTERS: Record<AgentKind, Record<Tier, RosterEntry>> = {
  claude: {
    light: { model: "haiku" },
    mid: { model: "sonnet" },
    frontier: { model: "opus" },
  },
  codex: {
    light: { model: "luna" },
    mid: { model: "terra" },
    frontier: { model: "sol" },
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
  reasoningDemandConfidence: 0.6,
};

function escalate(tier: Tier): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)];
}

function deescalate(tier: Tier): Tier {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(tier) - 1, 0)];
}

/**
 * Vendor pick when the caller has no opinion. A simple, documented default per
 * use case, adjustable once evals against real traffic say otherwise: most
 * classes default to claude, chore and test to codex.
 */
export const DEFAULT_VENDOR_TABLE: Record<UseCase, AgentKind> = {
  lookup: "claude",
  review: "claude",
  debug: "claude",
  implement: "claude",
  refactor: "claude",
  docs: "claude",
  other: "claude",
  chore: "codex",
  test: "codex",
};

/**
 * Vendor pick when the caller has no opinion: the default table, overridden by
 * the merged solutionShape signal only at its strong ends — a bulk/mechanical
 * task moves to codex even if its class defaults to claude, and a task where
 * design judgment dominates stays on claude even if its class defaults to
 * codex. options.kind (checked by the caller) always wins over both.
 */
function pickVendor(classification: Classification, thresholds: RoutingThresholds): AgentKind {
  const tableVendor = DEFAULT_VENDOR_TABLE[classification.useCase] ?? "claude";
  const isBulkMechanical = classification.solutionShape >= thresholds.noul;
  const isCraftDominant = classification.solutionShape <= 1 - thresholds.noul;

  if (tableVendor === "claude" && isBulkMechanical) return "codex";
  if (tableVendor === "codex" && isCraftDominant) return "claude";
  return tableVendor;
}

/** Base mapping from the reasoning pattern a task demands to codex's reasoning effort, independent of tier. */
const REASONING_EFFORT_BASE: Record<ReasoningDemand, ReasoningEffort> = {
  direct: "low",
  bounded: "medium",
  iterative: "high",
  deep: "xhigh",
};

/** Automatic selection only ever moves within this range; "none" and "max" require an explicit RouteOptions.effort override. */
const EFFORT_ESCALATION_ORDER: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

function bumpEffort(effort: ReasoningEffort): ReasoningEffort {
  const i = EFFORT_ESCALATION_ORDER.indexOf(effort);
  return EFFORT_ESCALATION_ORDER[Math.min(i + 1, EFFORT_ESCALATION_ORDER.length - 1)];
}

export interface EffortSelection {
  effort: ReasoningEffort;
  /** Set only when a guard rail moved the effort away from the base mapping. */
  reason?: string;
}

/**
 * Picks codex's reasoning effort from the task's reasoning demand alone — NOT
 * from the tier, so the same reasoningDemand always yields the same effort
 * regardless of which tier the task landed on.
 *
 * Two guard rails can raise (never lower) the base mapping:
 * - low confidence on reasoningDemand itself bumps the effort up one step;
 * - a use case the classifier is unsure about (the same floor route() checks)
 *   never gets "low" effort, since a wrong class guess makes "direct" an
 *   unreliable read. This floor is re-derived here rather than passed in, so
 *   this function keeps its two-argument, independently testable signature.
 */
export function selectReasoningEffort(
  classification: Classification,
  thresholds: RoutingThresholds,
): EffortSelection {
  let effort = REASONING_EFFORT_BASE[classification.reasoningDemand];
  let reason: string | undefined;

  if (classification.reasoningDemandConfidence < thresholds.reasoningDemandConfidence) {
    effort = bumpEffort(effort);
    reason = "low confidence on reasoning demand, effort raised one step";
  }

  const confidenceFloor =
    thresholds.useCaseConfidenceFloors?.[classification.useCase] ?? thresholds.minUseCaseConfidence;
  if (classification.useCaseConfidence < confidenceFloor && effort === "low") {
    effort = "medium";
    reason = "classifier unsure which task class this is, effort floored at medium";
  }

  return { effort, reason };
}

/**
 * Renders herd-spawn's -a value. For claude the permission flag has to be
 * re-included because passing -a replaces herd's default entirely.
 *
 * Least privilege applies to both vendors: a read-only task gets a read-only
 * worker (claude's `plan` permission mode, codex's `read-only` sandbox); any
 * write, local or external, needs the write-capable mode.
 *
 * codexModel, when given, overrides the roster's tier suffix with an already
 * resolved model id (see chooseModel()); route() itself never passes it, so
 * this stays synchronous and filesystem-free. Codex callers must supply
 * effort — route() always does, having just computed it via
 * selectReasoningEffort() or taken it from options.effort.
 */
export function renderWorker(
  kind: AgentKind,
  tier: Tier,
  executionScope: ExecutionScope,
  effort?: ReasoningEffort,
  codexModel?: string,
): WorkerChoice {
  const entry = ROSTERS[kind][tier];

  if (kind === "claude") {
    const permissionMode = executionScope === "read_only" ? "plan" : "acceptEdits";
    return {
      kind,
      model: entry.model,
      args: `--model ${entry.model} --permission-mode ${permissionMode}`,
    };
  }

  const sandbox = executionScope === "read_only" ? "read-only" : "workspace-write";
  const model = codexModel ?? entry.model;
  return {
    kind,
    model,
    effort,
    args: `-m ${model} -c model_reasoning_effort=${effort} --sandbox ${sandbox}`,
  };
}

export interface RouteOptions {
  kind?: AgentKind;
  table?: RoutingTable;
  thresholds?: RoutingThresholds;
  /** Overrides the automatic codex reasoning effort. Only valid when the resolved kind is "codex". */
  effort?: ReasoningEffort;
}

/**
 * Pure lookup: task class -> cheapest tier that should hold the bar, bumped one
 * tier when a signal changes the cost of being wrong, or when the classifier
 * itself is not confident which class this is. An unsure classification
 * escalating is deliberate: a cheap guess on an unrecognized task is the
 * expensive kind of mistake.
 */
export function route(classification: Classification, options: RouteOptions = {}): RoutingDecision {
  const table = options.table ?? DEFAULT_ROUTING_TABLE;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const kind = options.kind ?? pickVendor(classification, thresholds);

  if (kind === "claude" && options.effort !== undefined) {
    throw new Error(
      'RouteOptions.effort only applies to codex; the resolved kind here is "claude", so it would be silently ignored.',
    );
  }

  const { useCase, executionScope } = classification;
  const baseTier = table[useCase] ?? "mid";
  const isYes = (noul: number) => noul >= thresholds.noul;
  const isNo = (noul: number) => noul <= 1 - thresholds.noul;

  const reasons: string[] = [];
  if (isYes(classification.hardToReverse)) reasons.push("hard to reverse if wrong");
  if (executionScope === "external_effect") reasons.push("has an effect outside the working copy");
  if (isYes(classification.spansMultipleSystems)) reasons.push("spans 4+ systems");
  if (isNo(classification.solutionShape)) reasons.push("design judgment is the main difficulty");

  const confidenceFloor =
    thresholds.useCaseConfidenceFloors?.[useCase] ?? thresholds.minUseCaseConfidence;
  if (classification.useCaseConfidence < confidenceFloor) {
    reasons.push("classifier unsure which task class this is");
  }

  // Speculative answer, read only on the branches it was asked for, and only
  // once nothing risky has fired: bulk AND hard-to-reverse is the most
  // dangerous combination, not a reason to go cheaper.
  const bulkMechanical =
    (useCase === "chore" || useCase === "refactor") && isYes(classification.solutionShape);

  // hard_to_reverse and an external_effect scope are critical risk: they jump
  // straight to the frontier tier instead of a one-tier escalate, so a single
  // strong risk signal isn't watered down to the same effect as an escalate
  // that several weaker signals would also trigger. Weaker signals above still
  // only ever escalate by one tier, however many of them fire together.
  const criticalRisk = isYes(classification.hardToReverse) || executionScope === "external_effect";

  let tier = baseTier;
  if (criticalRisk) {
    tier = "frontier";
  } else if (reasons.length > 0) {
    tier = escalate(baseTier);
  } else if (bulkMechanical) {
    tier = deescalate(baseTier);
    if (tier !== baseTier) reasons.push("bulk mechanical work, dropped a tier");
  }

  let effort: ReasoningEffort | undefined;
  let effortReason: string | undefined;
  if (kind === "codex") {
    if (options.effort !== undefined) {
      effort = options.effort;
    } else {
      const selection = selectReasoningEffort(classification, thresholds);
      effort = selection.effort;
      effortReason = selection.reason;
    }
  }

  return {
    tier,
    worker: renderWorker(kind, tier, executionScope, effort),
    classification,
    escalated: TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(baseTier),
    reasons,
    effortReason,
  };
}

export function loadRoutingTable(overrides: Partial<RoutingTable>): RoutingTable {
  return { ...DEFAULT_ROUTING_TABLE, ...overrides };
}

export type { UseCase };
