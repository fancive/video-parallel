import assert from "node:assert/strict";
import test from "node:test";
import {
  ProcessingError,
  processingFailure,
  providerErrorMessage,
} from "../src/lib/processing-error";

test("provider errors preserve HTTP status even when the server supplies a message", () => {
  const message = providerErrorMessage('{"error":{"message":"Too many requests"}}', 429);
  const failure = processingFailure(new ProcessingError(message, "provider", 429), "response");
  assert.equal(failure.stage, "provider");
  assert.equal(failure.status, 429);
  assert.match(failure.message, /HTTP 429.*Too many requests/);
  assert.match(failure.hint, /限流或额度/);
  assert.equal(providerErrorMessage("<html>Bad gateway</html>", 502), "AI 请求失败：HTTP 502");
  assert.equal(providerErrorMessage("null", 500), "AI 请求失败：HTTP 500");
});

test("timeout and invalid summary failures give distinct recovery advice", () => {
  const timeout = processingFailure(new Error("AI 请求超过 120 秒，请重试。"), "provider");
  assert.match(timeout.hint, /时限/);
  const parse = processingFailure(
    new ProcessingError("AI 未返回全文要点。", "response"),
    "provider",
  );
  assert.equal(parse.stage, "response");
  assert.match(parse.hint, /格式/);
  const cache = processingFailure(new Error("QUOTA_BYTES exceeded"), "cache");
  assert.match(cache.hint, /已生成.*复制或导出/);
});

test("diagnostic messages redact the configured key and bound untrusted details", () => {
  const failure = processingFailure(
    new Error("Invalid secret-test-key; Bearer another-key"),
    "provider",
    "secret-test-key",
  );
  assert.doesNotMatch(failure.message, /secret-test-key|another-key/);
  assert.match(failure.message, /REDACTED/);
  assert.equal(processingFailure(new Error("x".repeat(3000)), "provider").message.length, 2000);
});
