import { choice, noul, type EntryType } from "@typesafe-ai/sdk";
import { typeSafeClient } from "../typesafe.js";
import type { Classification, TaskState } from "../types.js";

/**
 * One request, six questions. TypeSafe evaluates them in parallel against the
 * same state, so the five Nouls cost almost nothing on top of the Choice.
 *
 * The Choice options use the structured what/not_for/examples shape because the
 * boundaries that matter here are the confusable ones: debug vs implement,
 * refactor vs chore, review vs lookup.
 */
const ROUTING_QUESTIONS = {
  use_case: choice(
    {
      question: "What kind of coding work does this task ask a worker agent to do?",
      focus: "Classify the primary work requested, not every topic mentioned.",
    },
    {
      lookup: {
        what: "Answer a question about the codebase without changing it",
        not_for: "Judging the quality of a change, or finding the cause of a failure",
        examples: ["Where is the retry logic defined?", "Which endpoints use this middleware?"],
      },
      review: {
        what: "Judge an existing change or piece of code and report findings",
        not_for: "Writing the change itself, or diagnosing a runtime failure",
        examples: ["Review the auth diff", "Check this PR for security problems"],
      },
      debug: {
        what: "Find and fix the cause of a failure when the cause is not yet known",
        not_for: "Building something new, or restructuring code that works",
        examples: ["Fix the flaky auth test", "The webhook returns 500 intermittently, find out why"],
      },
      implement: {
        what: "Build new behaviour that does not exist yet",
        not_for: "Restructuring existing behaviour, or fixing something broken",
        examples: ["Add a CSV export endpoint", "Implement the password reset flow"],
      },
      refactor: {
        what: "Restructure existing code without changing what it does",
        not_for: "Adding behaviour, or fixing a bug",
        examples: [
          "Extract the billing logic into its own module",
          "Replace the callback chain with async/await",
        ],
      },
      test: {
        what: "Write or repair tests",
        not_for: "Fixing the production code the tests cover",
        examples: ["Add integration tests for the payment hub", "Backfill unit tests for the parser"],
      },
      docs: {
        what: "Write or update documentation, comments or changelogs",
        not_for: "Changing the code the documentation describes",
        examples: ["Document the socket API", "Update the README install section"],
      },
      chore: {
        what: "Mechanical or bulk work with a known, repetitive shape",
        not_for: "Work needing judgment about how the result should look",
        examples: ["Bump all dependencies to their latest minor", "Rename this symbol across the repo"],
      },
      other: {
        what: "None of the other options fit",
        not_for: "Anything that clearly matches another option",
      },
    },
  ),
  spans_multiple_systems: noul(
    "Completing this task requires touching four or more distinct systems, services or repositories.",
  ),
  hard_to_reverse: noul("If the worker gets this wrong, the consequences are costly or hard to undo.", {
    true: "Touches migrations, production data, deletions, published releases or shared infrastructure",
    false: "Confined to a working copy and trivially corrected by trying again",
  }),
  craft_is_main_difficulty: noul(
    "The main difficulty is design judgment — naming, structure, a public interface others depend on — rather than mechanical edits.",
  ),
  is_bulk_mechanical: noul(
    "The task is a repetitive edit applied across many files, with a known and uniform shape.",
  ),
  needs_write_access: noul("The worker must modify files to do this task.", {
    true: "Edits, creates or deletes files",
    false: "Reads, analyses or reports only",
  }),
};

function buildState(state: TaskState): EntryType {
  return state.context ? { task: state.text, context: state.context } : { task: state.text };
}

/**
 * The Jev step: one cheap, fast forward pass that answers a fixed set of typed
 * questions about a task. It never writes prose — it only decides.
 */
export async function classifyWithJev(state: TaskState): Promise<Classification> {
  const startedAt = Date.now();
  const { answers } = await typeSafeClient().systemOne({
    state: buildState(state),
    questions: ROUTING_QUESTIONS,
  });
  const latencyMs = Date.now() - startedAt;

  return {
    useCase: answers.use_case.choice,
    useCaseConfidence: answers.use_case.confidence,
    useCaseProbabilities: answers.use_case.probabilities,
    spansMultipleSystems: answers.spans_multiple_systems.noul,
    hardToReverse: answers.hard_to_reverse.noul,
    craftIsMainDifficulty: answers.craft_is_main_difficulty.noul,
    isBulkMechanical: answers.is_bulk_mechanical.noul,
    needsWriteAccess: answers.needs_write_access.noul,
    backend: "jev",
    latencyMs,
  };
}
