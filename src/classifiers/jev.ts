import type { Classification, TaskState, UseCase } from "../types.js";
import { USE_CASES } from "../types.js";
import { readChoice, readNoul, systemOne } from "../typesafe.js";

const DEFAULT_MODEL = "jev-latest";

/**
 * One request, four questions. TypeSafe evaluates them in parallel against the
 * same state, so the three escalation signals cost latency-wise almost nothing
 * on top of the use-case Choice.
 *
 * The Choice options use the structured what/not_for/examples shape because the
 * boundaries that matter here are the confusable ones: lookup vs analytics,
 * analytics vs investigation, communication vs deliverable.
 */
const ROUTING_QUESTIONS = {
  use_case: {
    type: "choice",
    instructions: {
      question: "What kind of work does this task ask for?",
      focus: "Classify the primary work requested, not every topic mentioned.",
    },
    criteria: {
      lookup: {
        what: "Retrieve a specific fact or record that already exists",
        not_for: "Comparing or computing over data, or finding an unknown cause",
        examples: ["What is this client's SIRET number?", "Which plan is this account on?"],
      },
      analytics: {
        what: "Compare, aggregate, or compute over data that already exists",
        not_for: "Retrieving one stored value, or diagnosing an unknown cause",
        examples: ["Compare conversion rates month over month", "What is the payment failure rate this week?"],
      },
      investigation: {
        what: "Find the cause of something when the cause is not yet known",
        not_for: "Computing a known metric, or retrieving a stored value",
        examples: ["Why did the sync silently drop 12 appointments?", "Find the cause of these intermittent 500s"],
      },
      summarization: {
        what: "Condense existing content into a shorter form",
        not_for: "Producing a standalone artifact, or writing a message to a person",
        examples: ["Summarize this 40-message thread", "One-sentence recap of the last ticket"],
      },
      communication: {
        what: "Write a message addressed to a person",
        not_for: "Producing a standalone document, or acting on a system",
        examples: ["Draft a follow-up email about an overdue invoice", "Reply to this unhappy customer"],
      },
      deliverable: {
        what: "Produce a finished standalone artifact such as a document, report, or deck",
        not_for: "A short message to a person, or condensing existing content",
        examples: ["Write the full client onboarding guide", "Prepare the quarterly review deck"],
      },
      automation: {
        what: "Take an action that changes state in a system",
        not_for: "Reading, analyzing, or writing content without changing anything",
        examples: ["Update the CRM stage for everyone who paid today", "Archive leads inactive for 90 days"],
      },
      other: {
        what: "None of the other options fit",
        not_for: "Anything that clearly matches another option",
      },
    },
  },
  spans_multiple_systems: {
    type: "noul",
    instructions: "Resolving this task requires touching four or more distinct systems or data sources.",
  },
  hard_to_reverse: {
    type: "noul",
    instructions: "If the answer or action is wrong, the consequences are costly or hard to undo.",
    criteria: {
      true: "Writes, deletes, sends, or otherwise changes state that someone would have to unwind",
      false: "Read-only, or trivially corrected by running it again",
    },
  },
  craft_is_main_difficulty: {
    type: "noul",
    instructions:
      "The main difficulty is the craft of the output (tone, polish, persuasiveness) rather than reaching a correct decision.",
  },
  // Speculative: each of these only matters on some branches, and route() ignores
  // them elsewhere. Questions run in parallel, so asking them always is close to free.
  is_bulk_operation: {
    type: "noul",
    instructions: "The task applies to many records or entities at once rather than a single one.",
  },
  is_client_facing: {
    type: "noul",
    instructions: "The output will be seen by someone outside the company, such as a client or a prospect.",
    criteria: {
      true: "Goes to an external reader as-is",
      false: "Stays internal, or is reviewed and rewritten before anyone outside sees it",
    },
  },
};

function toUseCase(choice: string): UseCase {
  return (USE_CASES as string[]).includes(choice) ? (choice as UseCase) : "other";
}

function buildState(state: TaskState): unknown {
  return state.context ? { task: state.text, context: state.context } : { task: state.text };
}

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
    isBulkOperation: readNoul(response.answers, "is_bulk_operation"),
    isClientFacing: readNoul(response.answers, "is_client_facing"),
    backend: "jev",
    latencyMs,
  };
}
