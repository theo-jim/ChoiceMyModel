import { classify } from "./classify.js";
import { DEFAULT_ROUTING_TABLE, route } from "./routingTable.js";
import type { RoutingDecision, RoutingTable, TaskState } from "./types.js";

/**
 * Public entry point: classify the task, then route it. This is the function
 * herd/herdr should call before dispatching a message to a model.
 */
export async function chooseModel(
  state: TaskState,
  table: RoutingTable = DEFAULT_ROUTING_TABLE,
): Promise<RoutingDecision> {
  const classification = await classify(state);
  return route(classification, table);
}
