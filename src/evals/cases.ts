import type { AgentKind, UseCase } from "../types.js";

export interface EvalCase {
  id: string;
  text: string;
  expectedUseCase: UseCase;
  /** Omitted where there is no clear-cut expectation for vendor fit yet. */
  expectedKind?: AgentKind;
}

/**
 * Seed set only. Routing should be pinned by evals against your OWN traffic,
 * not vibes — grow this file with real task texts you have handed to herd
 * workers, plus the class you would have picked for each.
 */
export const EVAL_CASES: EvalCase[] = [
  { id: "lookup-1", text: "Where is the retry logic for the webhook client defined?", expectedUseCase: "lookup" },
  { id: "lookup-2", text: "Which endpoints currently go through the auth middleware?", expectedUseCase: "lookup" },
  { id: "review-1", text: "Review the auth diff on this branch and report anything risky.", expectedUseCase: "review" },
  { id: "review-2", text: "Check PR #214 for SQL injection and missing input validation.", expectedUseCase: "review" },
  { id: "debug-1", text: "Fix the flaky auth test in tests/auth_test.py.", expectedUseCase: "debug" },
  { id: "debug-2", text: "The Doctolib sync silently dropped 12 appointments yesterday, find out why and fix it.", expectedUseCase: "debug" },
  { id: "implement-1", text: "Add a CSV export endpoint to the payment hub API.", expectedUseCase: "implement" },
  { id: "implement-2", text: "Implement the password reset flow, including the email template.", expectedUseCase: "implement" },
  { id: "refactor-1", text: "Extract the billing logic out of views.py into its own module.", expectedUseCase: "refactor" },
  { id: "refactor-2", text: "Replace the callback chain in the GHL client with async/await.", expectedUseCase: "refactor" },
  { id: "test-1", text: "Add integration tests covering the payment hub webhook handler.", expectedUseCase: "test" },
  { id: "test-2", text: "Backfill unit tests for the invoice parser.", expectedUseCase: "test" },
  { id: "docs-1", text: "Document the socket API in docs/socket-api.md.", expectedUseCase: "docs" },
  { id: "docs-2", text: "Update the README install section for the new CLI.", expectedUseCase: "docs" },
  { id: "chore-1", text: "Bump every dependency to its latest minor version and fix the lockfile.", expectedUseCase: "chore", expectedKind: "codex" },
  { id: "chore-2", text: "Rename the symbol `fetchUser` to `loadUser` across the whole repo.", expectedUseCase: "chore", expectedKind: "codex" },
  { id: "vendor-implement-1", text: "Design and implement the password reset flow, including deciding the email template's structure.", expectedUseCase: "implement", expectedKind: "claude" },
  { id: "vendor-refactor-1", text: "Replace every occurrence of `req.body.userId` with `req.user.id` across all 40 route handlers, same substitution everywhere.", expectedUseCase: "refactor", expectedKind: "codex" },
];
