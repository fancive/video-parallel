import assert from "node:assert/strict";
import test from "node:test";
import {
  notifySidePanelIfReady,
  openTabSidePanel,
  sidePanelPath,
  tabIdFromSidePanelSearch,
} from "../src/lib/side-panel";

test("user gesture path invokes only side panel open", async () => {
  const calls: string[] = [];
  const opened = openTabSidePanel(
    {
      open: async () => {
        calls.push("open");
      },
    },
    42,
  );

  assert.deepEqual(calls, ["open"]);
  await opened;
});

test("tab-specific side panel path carries its bound tab id", () => {
  const path = sidePanelPath(42);
  assert.equal(path, "sidepanel.html?tabId=42");
  assert.equal(tabIdFromSidePanelSearch("?tabId=42"), 42);
});

test("side panel rejects a missing or malformed tab binding", () => {
  assert.throws(() => tabIdFromSidePanelSearch(""), /无法识别侧面板所属的视频标签页/);
  assert.throws(
    () => tabIdFromSidePanelSearch("?tabId=not-a-number"),
    /无法识别侧面板所属的视频标签页/,
  );
  assert.throws(() => sidePanelPath(-1), /无法识别侧面板所属的视频标签页/);
});

test("missing receiver is normal while a new side panel boots", async () => {
  await assert.doesNotReject(
    notifySidePanelIfReady(
      {
        sendMessage: async () => {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        },
      },
      { type: "START_PROCESSING", tabId: 42 },
    ),
  );
});
