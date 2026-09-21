import { classifyWithJev } from "./classifiers/jev.js";
import { logDecision } from "./observability/log.js";
import { type RouteOptions, route } from "./routingTable.js";
import type { Classification, RoutingDecision, TaskState } from "./types.js";

export type ChooseModelOptions = RouteOptions;

type ClassifyFn = (state: TaskState) => Promise<Classification>;
type LogDecisionFn = (state: TaskState, kind: RouteOptions["kind"], decision: RoutingDecision) => void;

export interface ChooseModelDependencies {
  classify?: ClassifyFn;
  log?: LogDecisionFn;
}

/**
 * Public entry point: classify the task, then pick the worker. This is what
 * herd's head agent calls before herd-spawn.
 */
export async function chooseModel(
  state: TaskState,
  options: ChooseModelOptions = {},
  dependencies: ChooseModelDependencies = {},
): Promise<RoutingDecision> {
  const classification = await (dependencies.classify ?? classifyWithJev)(state);
  const decision = route(classification, options);
  try {
    (dependencies.log ?? logDecision)(state, options.kind, decision);
  } catch (err) {
    console.error("Could not record routing decision:", err);
  }
  return decision;
}
