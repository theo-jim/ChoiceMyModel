import Anthropic from "@anthropic-ai/sdk";
import type { Classification, TaskState } from "./types.js";

const client = new Anthropic();

const CLASSIFIER_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a routing classifier, not an assistant. You never answer the task
itself — you only decide what KIND of task it is, in one pass, so a router can pick
which model handles it. Answer every field of the tool call. Do not hedge: pick the
single best useCase even when a task could arguably fit more than one.`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_task",
  description:
    "Classify an incoming task along the dimensions used to pick a model tier for it.",
  input_schema: {
    type: "object",
    properties: {
      useCase: {
        type: "string",
        enum: [
          "lookup",
          "analytics",
          "investigation",
          "summarization",
          "communication",
          "deliverable",
          "automation",
          "other",
        ],
        description:
          "lookup: retrieve a known fact. analytics: compare/compute over data. " +
          "investigation: find the cause of something when the cause is unknown. " +
          "summarization: condense existing content. communication: a message to a person " +
          "(email, reply, DM). deliverable: a finished artifact (doc, report, page). " +
          "automation: an action that changes state in a system (update a record, trigger a workflow).",
      },
      spansMultipleSystems: {
        type: "boolean",
        description: "Does resolving this touch four or more distinct systems or data sources?",
      },
      hardToReverse: {
        type: "boolean",
        description: "If the model's answer or action is wrong, is it costly or hard to undo?",
      },
      craftIsMainDifficulty: {
        type: "boolean",
        description:
          "Is the main challenge producing well-crafted output (tone, polish, persuasiveness) " +
          "rather than reaching a correct decision?",
      },
      confidence: {
        type: "number",
        description: "Calibrated confidence in this classification, from 0 to 1.",
      },
    },
    required: ["useCase", "spansMultipleSystems", "hardToReverse", "craftIsMainDifficulty", "confidence"],
    additionalProperties: false,
  },
  strict: true,
};

function renderState(state: TaskState): string {
  return state.context ? `Context: ${state.context}\n\nTask: ${state.text}` : state.text;
}

/**
 * The Jev-equivalent step: one cheap, fast forward pass that answers a fixed
 * set of typed questions about a task. It never writes prose — it only decides.
 */
export async function classify(state: TaskState): Promise<Classification> {
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_task" },
    messages: [{ role: "user", content: renderState(state) }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("classifier did not return a tool call");
  }

  return toolUse.input as Classification;
}

export { CLASSIFIER_MODEL };
