import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompletionRequest,
  buildModelListRequest,
  parseCompletionResponse,
  parseCompletionResult,
  parseModelListResponse,
  shouldRetryWithoutJsonMode,
} from "../src/lib/provider-client";
import { normalizeSettings } from "../src/lib/settings";

const messages = [
  { role: "system" as const, content: "Return JSON." },
  { role: "user" as const, content: "Summarize this." },
];

test("OpenAI-compatible requests keep the configured endpoint and JSON mode", () => {
  const settings = normalizeSettings({ provider: "groq", apiKey: "groq-key" });
  const request = buildCompletionRequest(settings, messages);
  const headers = request.init.headers as Record<string, string>;
  const body = JSON.parse(String(request.init.body));

  assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(headers.Authorization, "Bearer groq-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, undefined);
});

test("Anthropic requests move the system prompt to the native top-level field", () => {
  const settings = normalizeSettings({ provider: "anthropic", apiKey: "anthropic-key" });
  const request = buildCompletionRequest(settings, messages);
  const headers = request.init.headers as Record<string, string>;
  const body = JSON.parse(String(request.init.body));

  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "anthropic-key");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(body.system, "Return JSON.");
  assert.deepEqual(body.messages, [{ role: "user", content: "Summarize this." }]);
});

test("Gemini requests use generateContent and native JSON response configuration", () => {
  const settings = normalizeSettings({ provider: "google", apiKey: "gemini-key" });
  const request = buildCompletionRequest(settings, messages);
  const headers = request.init.headers as Record<string, string>;
  const body = JSON.parse(String(request.init.body));

  assert.equal(
    request.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
  );
  assert.equal(headers["x-goog-api-key"], "gemini-key");
  assert.equal(body.systemInstruction.parts[0].text, "Return JSON.");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.maxOutputTokens, undefined);
});

test("completion parsers normalize text from all supported protocols", () => {
  assert.equal(
    parseCompletionResponse("openai-compatible", '{"choices":[{"message":{"content":"openai"}}]}'),
    "openai",
  );
  assert.equal(
    parseCompletionResponse("anthropic", '{"content":[{"type":"text","text":"claude"}]}'),
    "claude",
  );
  assert.equal(
    parseCompletionResponse("google", '{"candidates":[{"content":{"parts":[{"text":"gemini"}]}}]}'),
    "gemini",
  );
});

test("completion parsers preserve actual token usage across provider protocols", () => {
  assert.deepEqual(
    parseCompletionResult(
      "openai-compatible",
      '{"choices":[{"message":{"content":"openai"}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}',
    ),
    { content: "openai", usage: { inputTokens: 120, outputTokens: 30 } },
  );
  assert.deepEqual(
    parseCompletionResult(
      "anthropic",
      '{"content":[{"type":"text","text":"claude"}],"usage":{"input_tokens":100,"cache_creation_input_tokens":20,"cache_read_input_tokens":10,"output_tokens":40}}',
    ),
    { content: "claude", usage: { inputTokens: 130, outputTokens: 40 } },
  );
  assert.deepEqual(
    parseCompletionResult(
      "google",
      '{"candidates":[{"content":{"parts":[{"text":"gemini"}]}}],"usageMetadata":{"promptTokenCount":140,"candidatesTokenCount":35,"thoughtsTokenCount":5,"totalTokenCount":180}}',
    ),
    { content: "gemini", usage: { inputTokens: 140, outputTokens: 40 } },
  );
});

test("completion parser omits usage when a provider does not report complete counts", () => {
  assert.deepEqual(
    parseCompletionResult(
      "openai-compatible",
      '{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":12}}',
    ),
    { content: "ok" },
  );
});

test("model discovery uses native endpoints and filters non-generation Gemini models", () => {
  const anthropic = buildModelListRequest(
    normalizeSettings({ provider: "anthropic", apiKey: "key" }),
  );
  const google = buildModelListRequest(normalizeSettings({ provider: "google", apiKey: "key" }));
  assert.equal(anthropic.url, "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(google.url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.deepEqual(
    parseModelListResponse(
      "google",
      '{"models":[{"name":"models/gemini-a","supportedGenerationMethods":["generateContent"]},{"name":"models/embed-a","supportedGenerationMethods":["embedContent"]}]}',
    ),
    ["gemini-a"],
  );
});

test("JSON mode fallback is limited to optional-parameter errors", () => {
  assert.equal(shouldRetryWithoutJsonMode(400, "response_format is unsupported"), true);
  assert.equal(shouldRetryWithoutJsonMode(401, "response_format is unsupported"), false);
  assert.equal(shouldRetryWithoutJsonMode(400, "model not found"), false);
});
