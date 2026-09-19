import type { Classification, TaskState, UseCase } from "../types.js";
import { USE_CASES } from "../types.js";
import { readChoice, readNoul, systemOne } from "../typesafe.js";

const DEFAULT_MODEL = "jev-latest";

/**
 * One request, six questions. TypeSafe evaluates them in parallel against the
 * same state, so the five Nouls cost almost nothing on top of the Choice.
 *
 * The Choice options use the structured what/not_for/examples shape because the
 * boundaries that matter here are the confusable ones: debug vs implement,
 * refactor vs chore, review vs lookup.
 */
const ROUTING_QUESTIONS = {
  use_case: {
    type: "choice",
    instructions: {
      question: "What kind of coding work does this task ask a worker agent to do?",
      focus: "Classify the primary work requested, not every topic mentioned.",
    },
    criteria: {
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
        examples: ["Extract the billing logic into its own module", "Replace the callback chain with async/await"],
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
  },
  spans_multiple_systems: {
    type: "noul",
    instructions: "Completing this task requires touching four or more distinct systems, services or repositories.",
  },
  hard_to_reverse: {
    type: "noul",
    instructions: "If the worker gets this wrong, the consequences are costly or hard to undo.",
    criteria: {
      true: "Touches migrations, production data, deletions, published releases or shared infrastructure",
      false: "Confined to a working copy and trivially corrected by trying again",
    },
  },
  craft_is_main_difficulty: {
    type: "noul",
    instructions:
      "The main difficulty is design judgment — naming, structure, a public interface others depend on — rather than mechanical edits.",
  },
  is_bulk_mechanical: {
    type: "noul",
    instructions: "The task is a repetitive edit applied across many files, with a known and uniform shape.",
  },
  needs_write_access: {
    type: "noul",
    instructions: "The worker must modify files to do this task.",
    criteria: {
      true: "Edits, creates or deletes files",
      false: "Reads, analyses or reports only",
    },
  },
};

function toUseCase(choice: string): UseCase {
  return (USE_CASES as string[]).includes(choice) ? (choice as UseCase) : "other";
}

function buildState(state: TaskState): unknown {
  return state.context ? { task: state.text, context: state.context } : { task: state.text };
}

/**
 * The Jev step: one cheap, fast forward pass that answers a fixed set of typed
 * questions about a task. It never writes prose — it only decides.
 */
export async function classifyWithJev(state: TaskState): Promise<Classification> {
  const startedAt = Date.now();
  const response = await systemOne({
    state: buildState(state),
    model: process.env.TYPESAFE_DEFAULT_MODEL ?? DEFAULT_MODEL,
    questions: ROUTING_QUESTIONS,
  });
  const latencyMs = Date.now() - startedAt;

  const useCase = readChoice(response.answers, "use_case");

  return {
    useCase: toUseCase(useCase.choice),
    useCaseConfidence: useCase.confidence,
    useCaseProbabilities: useCase.probabilities,
    spansMultipleSystems: readNoul(response.answers, "spans_multiple_systems"),
    hardToReverse: readNoul(response.answers, "hard_to_reverse"),
    craftIsMainDifficulty: readNoul(response.answers, "craft_is_main_difficulty"),
    isBulkMechanical: readNoul(response.answers, "is_bulk_mechanical"),
    needsWriteAccess: readNoul(response.answers, "needs_write_access"),
    backend: "jev",
    latencyMs,
  };
}
