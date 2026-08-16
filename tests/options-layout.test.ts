import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings expose protocol routing, model discovery, testing, and manual model entry", async () => {
  const html = await readFile(new URL("../public/options.html", import.meta.url), "utf8");

  assert.match(html, /id="provider"/);
  assert.match(html, /id="protocol"/);
  assert.match(html, /value="openai-compatible"/);
  assert.match(html, /value="anthropic"/);
  assert.match(html, /value="google"/);
  assert.match(html, /id="model"[^>]+list="modelOptions"/);
  assert.match(html, /id="discoverModelsButton"/);
  assert.match(html, /id="testProviderButton"/);
  assert.match(html, /role="status" aria-live="polite"/);
});
