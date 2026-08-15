import assert from "node:assert/strict";
import test from "node:test";
import { makeTranslationBatches, parseTranslationResponse } from "../src/lib/translation";
import type { TranscriptSegment } from "../src/lib/types";

function segment(index: number, text = `segment ${index}`): TranscriptSegment {
  return { id: `s${index}`, startMs: index * 1000, durationMs: 1000, text };
}

test("makeTranslationBatches respects segment and character bounds", () => {
  const batches = makeTranslationBatches(Array.from({ length: 33 }, (_, index) => segment(index)));
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [8, 8, 8, 8, 1],
  );

  const characterBatches = makeTranslationBatches([
    segment(1, "a".repeat(3000)),
    segment(2, "b".repeat(2000)),
  ]);
  assert.equal(characterBatches.length, 2);
});

test("parseTranslationResponse aligns translations by stable id", () => {
  const translations = parseTranslationResponse(
    '```json\n{"translations":[{"id":"s2","text":"二"},{"id":"s1","text":"一"}]}\n```',
    ["s1", "s2"],
  );
  assert.deepEqual(translations, {
    translations: { s2: "二", s1: "一" },
    missingIds: [],
  });
});

test("parseTranslationResponse preserves partial output and reports only missing ids", () => {
  assert.deepEqual(
    parseTranslationResponse('{"translations":[{"id":"s1","text":"一"}]}', ["s1", "s2"]),
    { translations: { s1: "一" }, missingIds: ["s2"] },
  );
});

test("parseTranslationResponse accepts an object map and harmless JSON noise", () => {
  assert.deepEqual(
    parseTranslationResponse('Result:\n```json\n{"translations":{"s1":"一","s2":"二",},}\n```', [
      "s1",
      "s2",
    ]),
    { translations: { s1: "一", s2: "二" }, missingIds: [] },
  );
});
