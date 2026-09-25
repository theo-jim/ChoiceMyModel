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

test("ignores a [profiles.*] table's model when no profile is active", async () => {
  const model = await resolveCodexModel(
    "light",
    "/fake/config.toml",
    reader('model = "gpt-5.6"\n\n[profiles.fast]\nmodel = "gpt-4.1"\n'),
  );
  assert.equal(model, "gpt-5.6-luna");
});

test("prefers the active profile's model over the top-level one", async () => {
  const model = await resolveCodexModel(
    "mid",
    "/fake/config.toml",
    reader(
      [
        'model = "gpt-5.6"',
        'profile = "fast"',
        "",
        "[profiles.fast]",
        'model = "gpt-9.9"',
      ].join("\n"),
    ),
  );
  assert.equal(model, "gpt-9.9-terra");
});

test("falls back to the top-level model when the active profile has no model of its own", async () => {
  const model = await resolveCodexModel(
    "mid",
    "/fake/config.toml",
    reader(
      ['model = "gpt-5.6"', 'profile = "fast"', "", "[profiles.fast]", 'effort = "high"'].join("\n"),
    ),
  );
  assert.equal(model, "gpt-5.6-terra");
});

test("parses a literal (single-quoted) TOML string", async () => {
  const model = await resolveCodexModel("mid", "/fake/config.toml", reader("model = 'gpt-5.6-sol'\n"));
  assert.equal(model, "gpt-5.6-terra");
});

test("parses a quoted key", async () => {
  const model = await resolveCodexModel("mid", "/fake/config.toml", reader('"model" = "gpt-5.6"\n'));
  assert.equal(model, "gpt-5.6-terra");
});

test("does not mistake a bracket line inside a triple-quoted string for a table header", async () => {
  const toml = [
    'description = """',
    "Multi-line text",
    "[Not a table header]",
    "more text",
    '"""',
    'model = "gpt-5.6"',
  ].join("\n");
  const model = await resolveCodexModel("mid", "/fake/config.toml", reader(toml));
  assert.equal(model, "gpt-5.6-terra");
});

test("does not mistake a bracket entry inside a multi-line array for a table header", async () => {
  const toml = ['extra = [', '  "a",', '  "[not a table]",', "]", 'model = "gpt-5.6"'].join("\n");
  const model = await resolveCodexModel("mid", "/fake/config.toml", reader(toml));
  assert.equal(model, "gpt-5.6-terra");
});

test("throws when the config file cannot be read", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", async () => {
      throw new Error("ENOENT: no such file or directory");
    }),
    /Could not read the Codex config/,
  );
});

test("throws when the config is not valid TOML", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", reader("model = \n")),
    /Could not parse the Codex config/,
  );
});

test("throws when the config has no model key, active profile or top level", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", reader('[profiles.fast]\nmodel = "gpt-4.1"\n')),
    /No "model" key found/,
  );
});

test("throws when the model value does not match the expected shape", async () => {
  await assert.rejects(
    resolveCodexModel("mid", "/fake/config.toml", reader('model = "o3"\n')),
    /does not match the expected/,
  );
});
