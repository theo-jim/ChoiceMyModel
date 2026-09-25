import { classifyWithJev } from "./classifiers/jev.js";
import { type CodexConfigReader, resolveCodexModel } from "./codexModel.js";
import { logDecision } from "./observability/log.js";
import { renderWorker, type RouteOptions, route } from "./routingTable.js";
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

const CODEX_UNAVAILABLE_FALLBACK_REASON = "codex config unavailable, fell back to claude";
const CODEX_UNAVAILABLE_EXPLICIT_REASON = "codex config unavailable, model resolution failed";

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

    try {
      const model = await resolve(decision.tier);
      decision.worker = renderWorker("codex", decision.tier, classification.executionScope, decision.worker.effort, model);
    } catch (err) {
      if (options.kind === "codex") {
        // The caller pinned codex explicitly, so failing loudly is still the
        // right call — but the attempt is worth keeping in the decision log
        // before it's lost to the thrown error.
        decision.vendorFallbackReason = CODEX_UNAVAILABLE_EXPLICIT_REASON;
        try {
          (dependencies.log ?? logDecision)(state, options.kind, decision);
        } catch (logErr) {
          console.error("Could not record routing decision:", logErr);
        }
        throw err;
      }

      // The vendor was auto-picked (no explicit --kind codex): codex isn't
      // usable on this machine right now, so fall back to claude rather than
      // fail a routing call the caller never asked to pin to codex.
      decision.worker = renderWorker("claude", decision.tier, classification.executionScope);
      decision.vendorFallbackReason = CODEX_UNAVAILABLE_FALLBACK_REASON;
      // The codex reasoning effort route() picked no longer applies to a claude worker.
      decision.effortReason = undefined;
    }
  }

  try {
    (dependencies.log ?? logDecision)(state, options.kind, decision);
  } catch (err) {
    console.error("Could not record routing decision:", err);
  }
  return decision;
}
