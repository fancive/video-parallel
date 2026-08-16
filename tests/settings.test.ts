import assert from "node:assert/strict";
import test from "node:test";
import {
  chatCompletionsUrl,
  normalizeSettings,
  providerFingerprint,
  providerOriginPattern,
  providerRequiresApiKey,
} from "../src/lib/settings";

test("normalizeSettings rejects insecure non-local endpoints", () => {
  assert.throws(() => normalizeSettings({ baseUrl: "http://example.com/v1" }), /必须使用 https/);
});

test("provider URL helpers request one origin and one chat endpoint", () => {
  assert.equal(
    chatCompletionsUrl("https://api.example.com/v1/"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(providerOriginPattern("https://api.example.com/v1"), "https://api.example.com/*");
  assert.equal(providerOriginPattern("http://localhost:11434/v1"), "http://localhost:11434/*");
});

test("provider fingerprint excludes the API key", () => {
  const settings = normalizeSettings({
    provider: "custom",
    baseUrl: "https://api.example.com/v1",
    model: "example-model",
    apiKey: "very-secret",
  });
  const fingerprint = providerFingerprint(settings);
  assert.match(fingerprint, /example-model/);
  assert.doesNotMatch(fingerprint, /very-secret/);
});

test("provider presets derive their native protocol while custom keeps the selected protocol", () => {
  assert.equal(normalizeSettings({ provider: "anthropic" }).protocol, "anthropic");
  assert.equal(normalizeSettings({ provider: "google" }).protocol, "google");
  assert.equal(
    normalizeSettings({ provider: "custom", protocol: "anthropic" }).protocol,
    "anthropic",
  );
});

test("only local endpoints may omit an API key", () => {
  assert.equal(providerRequiresApiKey(normalizeSettings({ provider: "openai" })), true);
  assert.equal(providerRequiresApiKey(normalizeSettings({ provider: "local" })), false);
  assert.equal(
    providerRequiresApiKey(
      normalizeSettings({
        provider: "custom",
        baseUrl: "http://localhost:8080/v1",
        model: "local-model",
      }),
    ),
    false,
  );
});
