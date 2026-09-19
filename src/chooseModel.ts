import { getClassifier } from "./classify.js";
import { DEFAULT_ROUTING_TABLE, DEFAULT_THRESHOLDS, route } from "./routingTable.js";
import type {
  ClassifierBackend,
  RoutingDecision,
  RoutingTable,
  RoutingThresholds,
  TaskState,
} from "./types.js";

export interface ChooseModelOptions {
  backend?: ClassifierBackend;
  table?: RoutingTable;
  thresholds?: RoutingThresholds;
}

/**
 * Public entry point: classify the task, then route it. This is the function
 * herd/herdr should call before dispatching a message to a model.
 */
export async function chooseModel(
  state: TaskState,
  options: ChooseModelOptions = {},
): Promise<RoutingDecision> {
  const classify = getClassifier(options.backend);
  const classification = await classify(state);
  return route(
    classification,
    options.table ?? DEFAULT_ROUTING_TABLE,
    options.thresholds ?? DEFAULT_THRESHOLDS,
  );
}
