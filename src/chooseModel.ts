import { classifyWithJev } from "./classifiers/jev.js";
import { type RouteOptions, route } from "./routingTable.js";
import type { RoutingDecision, TaskState } from "./types.js";

export type ChooseModelOptions = RouteOptions;

/**
 * Public entry point: classify the task, then pick the worker. This is what
 * herd's head agent calls before herd-spawn.
 */
export async function chooseModel(
  state: TaskState,
  options: ChooseModelOptions = {},
): Promise<RoutingDecision> {
  const classification = await classifyWithJev(state);
  return route(classification, options);
}
