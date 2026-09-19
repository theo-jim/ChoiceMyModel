export type UseCase =
  | "lookup"
  | "analytics"
  | "investigation"
  | "summarization"
  | "communication"
  | "deliverable"
  | "automation"
  | "other";

export const USE_CASES: UseCase[] = [
  "lookup",
  "analytics",
  "investigation",
  "summarization",
  "communication",
  "deliverable",
  "automation",
  "other",
];

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface TaskState {
  /** The incoming message or task text herd/herdr wants routed to a model. */
  text: string;
  /** Optional extra context: thread history, calling agent name, tool count, etc. */
  context?: string;
}

export interface Classification {
  useCase: UseCase;
  /** Confidence in the use-case pick, 0 to 1. Calibrated when it comes from Jev. */
  useCaseConfidence: number;
  /** Full distribution across use cases. Jev returns one; the Claude backend does not. */
  useCaseProbabilities?: Record<string, number>;
  /** Probability that the task touches 4+ systems, 0 to 1. */
  spansMultipleSystems: number;
  /** Probability that a wrong answer is costly or hard to undo, 0 to 1. */
  hardToReverse: number;
  /** Probability that craft, not correctness, is the main difficulty, 0 to 1. */
  craftIsMainDifficulty: number;
  /** Speculative: only read when the use case is automation. */
  isBulkOperation: number;
  /** Speculative: only read when the use case is communication or deliverable. */
  isClientFacing: number;
  /** Which backend produced this classification. */
  backend: ClassifierBackend;
  /** Wall-clock time of the classify call, in milliseconds. */
  latencyMs: number;
}

export type ClassifierBackend = "jev" | "claude";

export type Classifier = (state: TaskState) => Promise<Classification>;

export interface RoutingThresholds {
  /** A Noul probability at or above this counts as a yes. */
  noul: number;
  /** Global floor: below this use-case confidence, the class is not trusted and the tier is bumped. */
  minUseCaseConfidence: number;
  /**
   * Per-class floors that override the global one. A confidence threshold is not
   * one number: a class whose mistakes are expensive should have to clear a
   * higher bar before the cheap tier is trusted.
   */
  useCaseConfidenceFloors?: Partial<Record<UseCase, number>>;
}

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  classification: Classification;
  escalated: boolean;
  reasons: string[];
}

export type RoutingTable = Record<UseCase, ModelTier>;
