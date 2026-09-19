export type UseCase =
  | "lookup"
  | "analytics"
  | "investigation"
  | "summarization"
  | "communication"
  | "deliverable"
  | "automation"
  | "other";

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface TaskState {
  /** The incoming message or task text herd/herdr wants routed to a model. */
  text: string;
  /** Optional extra context: thread history, calling agent name, tool count, etc. */
  context?: string;
}

export interface Classification {
  useCase: UseCase;
  spansMultipleSystems: boolean;
  hardToReverse: boolean;
  craftIsMainDifficulty: boolean;
  /** Calibrated confidence in this classification, 0 to 1. */
  confidence: number;
}

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  classification: Classification;
  escalated: boolean;
  reasons: string[];
}

export type RoutingTable = Record<UseCase, ModelTier>;
