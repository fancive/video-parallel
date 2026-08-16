import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PANEL_PREFERENCES, normalizePanelPreferences } from "../src/lib/panel-preferences";

test("panel font size defaults to standard", () => {
  assert.deepEqual(normalizePanelPreferences(undefined), DEFAULT_PANEL_PREFERENCES);
  assert.deepEqual(
    normalizePanelPreferences({ fontSize: "unexpected" }),
    DEFAULT_PANEL_PREFERENCES,
  );
});

test("panel font size accepts every supported reading size", () => {
  assert.equal(normalizePanelPreferences({ fontSize: "small" }).fontSize, "small");
  assert.equal(normalizePanelPreferences({ fontSize: "standard" }).fontSize, "standard");
  assert.equal(normalizePanelPreferences({ fontSize: "large" }).fontSize, "large");
});
