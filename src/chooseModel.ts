import { classifyWithJev } from "./classifiers/jev.js";
import { type CodexConfigReader, resolveCodexModel } from "./codexModel.js";
import { logDecision } from "./observability/log.js";
import { type RouteOptions, route } from "./routingTable.js";
import type { Classification, RoutingDecision, TaskState } from "./types.js";

export type ChooseModelOptions = RouteOptions;

type ClassifyFn = (state: TaskState) => Promise<Classification>;
type LogDecisionFn = (state: TaskState, kind: RouteOptions["kind"], decision: RoutingDecision) => void;
type ResolveCodexModelFn = (tier: RoutingDecision["tier"]) => Promise<string>;

export interface ChooseModelDependencies {
  classify?: ClassifyFn;
  log?: LogDecisionFn;
  /** Overrides resolveCodexModel entirely; takes precedence over codexConfigPath/codexConfigReader. */
  resolveCodexModel?: ResolveCodexModelFn;
  codexConfigPath?: string;
  codexConfigReader?: CodexConfigReader;
}

/**
 * Public entry point: classify the task, then pick the worker. This is what
 * herd's head agent calls before herd-spawn.
 *
 * route() stays pure and filesystem-free, so a codex worker comes back from it
 * with the roster's bare tier suffix (e.g. "terra"). Only here, once we know
 * the pick is codex, do we hit the filesystem to resolve the real model id —
 * keeping route() synchronously testable.
 */
export async function chooseModel(
  state: TaskState,
  options: ChooseModelOptions = {},
  dependencies: ChooseModelDependencies = {},
): Promise<RoutingDecision> {
  const classification = await (dependencies.classify ?? classifyWithJev)(state);
  const decision = route(classification, options);

  if (decision.worker.kind === "codex") {
    const resolve =
      dependencies.resolveCodexModel ??
      ((tier: RoutingDecision["tier"]) =>
        resolveCodexModel(tier, dependencies.codexConfigPath, dependencies.codexConfigReader));
    const model = await resolve(decision.tier);
    decision.worker = {
      ...decision.worker,
      model,
      args: decision.worker.args.replace(/^-m \S+/, `-m ${model}`),
    };
  }

  try {
    (dependencies.log ?? logDecision)(state, options.kind, decision);
  } catch (err) {
    console.error("Could not record routing decision:", err);
  }
  return decision;
}
