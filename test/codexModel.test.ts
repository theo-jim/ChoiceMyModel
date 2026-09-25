import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCodexModel } from "../src/codexModel.js";

function reader(contents: string) {
  return async () => contents;
}

test("resolves a model with a recognized tier suffix already in the config", async () => {
  const model = await resolveCodexModel(
    "mid",
    "/fake/config.toml",
    reader('model = "gpt-5.6-sol"\n'),
  );
  assert.equal(model, "gpt-5.6-terra");
});

test("resolves a bare version alias with no tier suffix", async () => {
  const model = await resolveCodexModel("frontier", "/fake/config.toml", reader('model = "gpt-5.6"\n'));
  assert.equal(model, "gpt-5.6-sol");
});

test("ignores a model key inside a [profiles.*] table", async () => {
  const model = await resolveCodexModel(
    "light",
    "/fake/config.toml",
    reader('model = "gpt-5.6"\n\n[profiles.fast]\nmodel = "gpt-4.1"\n'),
  );
  assert.equal(model, "gpt-5.6-luna");
});

test("throws when the config file cannot be read", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", async () => {
      throw new Error("ENOENT: no such file or directory");
    }),
    /Could not read the Codex config/,
  );
});

test("throws when the config has no top-level model key", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", reader('[profiles.fast]\nmodel = "gpt-4.1"\n')),
    /No top-level "model" key/,
  );
});

test("throws when the model value does not match the expected shape", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", reader('model = "o3"\n')),
    /does not match the expected/,
  );
});
