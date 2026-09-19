import Anthropic from "@anthropic-ai/sdk";
import type { Classification, TaskState, UseCase } from "../types.js";
import { USE_CASES } from "../types.js";

const client = new Anthropic();

const CLASSIFIER_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a routing classifier, not an assistant. You never do the task
itself — you only decide what KIND of coding task it is, in one pass, so a router can pick which
agent and model handles it. Answer every field of the tool call. Do not hedge: pick the single
best useCase even when a task could arguably fit more than one.`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_task",
  description: "Classify a coding task along the dimensions used to pick an agent and model for it.",
  input_schema: {
    type: "object",
    properties: {
      useCase: {
        type: "string",
        enum: USE_CASES,
        description:
          "lookup: answer a question about the codebase without changing it. review: judge an " +
          "existing change. debug: find and fix the cause of a failure. implement: build new " +
          "behaviour. refactor: restructure without changing behaviour. test: write or repair " +
          "tests. docs: documentation. chore: mechanical or bulk work.",
      },
      useCaseConfidence: {
        type: "number",
        description: "How certain you are of the useCase pick, from 0 to 1.",
      },
      spansMultipleSystems: {
        type: "number",
        description:
          "Probability from 0 to 1 that this requires touching four or more distinct systems, services or repositories.",
      },
      hardToReverse: {
        type: "number",
        description: "Probability from 0 to 1 that getting this wrong is costly or hard to undo.",
      },
      craftIsMainDifficulty: {
        type: "number",
        description:
          "Probability from 0 to 1 that the main difficulty is design judgment (naming, structure, " +
          "a public interface) rather than mechanical edits.",
      },
      isBulkMechanical: {
        type: "number",
        description:
          "Probability from 0 to 1 that this is a repetitive edit across many files with a uniform shape.",
      },
      needsWriteAccess: {
        type: "number",
        description: "Probability from 0 to 1 that the worker must modify files to do this task.",
      },
    },
    required: [
      "useCase",
      "useCaseConfidence",
      "spansMultipleSystems",
      "hardToReverse",
      "craftIsMainDifficulty",
      "isBulkMechanical",
      "needsWriteAccess",
    ],
    additionalProperties: false,
  },
  strict: true,
};

interface ClaudeClassifierInput {
  useCase: UseCase;
  useCaseConfidence: number;
  spansMultipleSystems: number;
  hardToReverse: number;
  craftIsMainDifficulty: number;
  isBulkMechanical: number;
  needsWriteAccess: number;
}

function renderState(state: TaskState): string {
  return state.context ? `Context: ${state.context}\n\nTask: ${state.text}` : state.text;
}

/**
 * Comparison backend. Claude reports these numbers about itself; unlike Jev's,
 * they are not calibrated against outcomes, so treat them as a baseline to
 * measure Jev against rather than an equivalent signal.
 */
export async function classifyWithClaude(state: TaskState): Promise<Classification> {
  const startedAt = Date.now();
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_task" },
    messages: [{ role: "user", content: renderState(state) }],
  });
  const latencyMs = Date.now() - startedAt;

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("classifier did not return a tool call");
  }

  const input = toolUse.input as ClaudeClassifierInput;

  return { ...input, backend: "claude", latencyMs };
}

export { CLASSIFIER_MODEL };
