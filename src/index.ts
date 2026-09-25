export { chooseModel, type ChooseModelDependencies, type ChooseModelOptions } from "./chooseModel.js";
export { classifyWithJev } from "./classifiers/jev.js";
export { type CodexConfigReader, resolveCodexModel } from "./codexModel.js";
export {
  DEFAULT_ROUTING_TABLE,
  DEFAULT_THRESHOLDS,
  DEFAULT_VENDOR_TABLE,
  /**
   * The claude and codex model selectors the routing table renders into
   * herd-spawn args, keyed by tier: for claude a bare --model alias
   * ("haiku"/"sonnet"/"opus") the claude CLI resolves itself, for codex a tier
   * suffix ("luna"/"terra"/"sol") whose version prefix is resolved at runtime
   * by resolveCodexModel() — never a fully resolved model id.
   */
  ROSTERS,
  loadRoutingTable,
  renderWorker,
  route,
  type RouteOptions,
} from "./routingTable.js";
export { typeSafeClient } from "./typesafe.js";
export type {
  AgentKind,
  Classification,
  ExecutionScope,
  ReasoningEffort,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  TaskState,
  Tier,
  UseCase,
  WorkerChoice,
} from "./types.js";
