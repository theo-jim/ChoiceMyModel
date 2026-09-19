/**
 * Task classes for coding-agent work, since herd spawns coding agents.
 * These are the classes the routing table pins to a tier.
 */
export type UseCase =
  | "lookup"
  | "review"
  | "debug"
  | "implement"
  | "refactor"
  | "test"
  | "docs"
  | "chore"
  | "other";

export const USE_CASES: UseCase[] = [
  "lookup",
  "review",
  "debug",
  "implement",
  "refactor",
  "test",
  "docs",
  "chore",
  "other",
];

/** herd-spawn -k */
export type AgentKind = "claude" | "codex";

/** Vendor-independent capability tier. The routing table speaks in these. */
export type Tier = "light" | "mid" | "frontier";

/** codex -c model_reasoning_effort. Claude Code has no equivalent flag. */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface TaskState {
  /** The task text that will be handed to the worker. */
  text: string;
  /** Optional extra context: repo, calling agent, prior report. */
  context?: string;
}

export interface Classification {
  useCase: UseCase;
  /** Confidence in the use-case pick, 0 to 1. Calibrated when it comes from Jev. */
  useCaseConfidence: number;
  /** Full distribution across use cases. */
  useCaseProbabilities?: Record<string, number>;
  /** Probability that the task touches 4+ systems, services or repos, 0 to 1. */
  spansMultipleSystems: number;
  /** Probability that a wrong answer is costly or hard to undo, 0 to 1. */
  hardToReverse: number;
  /** Probability that design judgment, not mechanical edits, is the main difficulty, 0 to 1. */
  craftIsMainDifficulty: number;
  /** Speculative: read on the chore and refactor branches. */
  isBulkMechanical: number;
  /** Probability the worker must modify files; drives the codex sandbox flag. */
  needsWriteAccess: number;
  /** Probability that codex (over claude) is the better-suited vendor for this task. */
  vendorFit: number;
  backend: "jev";
  latencyMs: number;
}

export interface RoutingThresholds {
  /** A Noul probability at or above this counts as a yes. */
  noul: number;
  /** Global floor: below this use-case confidence, the class is not trusted and the tier is bumped. */
  minUseCaseConfidence: number;
  /** Per-class floors that override the global one, for classes whose mistakes are expensive. */
  useCaseConfidenceFloors?: Partial<Record<UseCase, number>>;
}

export interface WorkerChoice {
  kind: AgentKind;
  model: string;
  effort?: ReasoningEffort;
  /** Rendered value for herd-spawn -a */
  args: string;
}

export interface RoutingDecision {
  tier: Tier;
  worker: WorkerChoice;
  classification: Classification;
  escalated: boolean;
  reasons: string[];
}

export type RoutingTable = Record<UseCase, Tier>;
