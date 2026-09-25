export { chooseModel, type ChooseModelDependencies, type ChooseModelOptions } from "./chooseModel.js";
export { classifyWithJev } from "./classifiers/jev.js";
export { type CodexConfigReader, resolveCodexModel } from "./codexModel.js";
export {
  DEFAULT_ROUTING_TABLE,
  DEFAULT_THRESHOLDS,
  DEFAULT_VENDOR_TABLE,
  type EffortSelection,
  /**
   * The claude and codex model selectors the routing table renders into
   * herd-spawn args, keyed by tier: for claude a bare --model alias
   * ("haiku"/"sonnet"/"opus") the claude CLI resolves itself, for codex a tier
   * suffix ("luna"/"terra"/"sol") whose version prefix is resolved at runtime
   * by resolveCodexModel() — never a fully resolved model id. The roster no
   * longer carries a reasoning effort; that's selectReasoningEffort's job,
   * decoupled from tier on purpose.
   */
  ROSTERS,
  loadRoutingTable,
  renderWorker,
  route,
  type RouteOptions,
  selectReasoningEffort,
} from "./routingTable.js";
export { typeSafeClient } from "./typesafe.js";
export type {
  AgentKind,
  Classification,
  ExecutionScope,
  ReasoningDemand,
  ReasoningEffort,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  TaskState,
  Tier,
  UseCase,
  WorkerChoice,
} from "./types.js";
