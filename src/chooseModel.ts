import { getClassifier } from "./classify.js";
import { type RouteOptions, route } from "./routingTable.js";
import type { ClassifierBackend, RoutingDecision, TaskState } from "./types.js";

export interface ChooseModelOptions extends RouteOptions {
  backend?: ClassifierBackend;
}

/**
 * Public entry point: classify the task, then pick the worker. This is what
 * herd's head agent calls before herd-spawn.
 */
export async function chooseModel(
  state: TaskState,
  options: ChooseModelOptions = {},
): Promise<RoutingDecision> {
  const { backend, ...routeOptions } = options;
  const classify = getClassifier(backend);
  const classification = await classify(state);
  return route(classification, routeOptions);
}
