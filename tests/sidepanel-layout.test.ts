import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("side panel keeps playback controls in the compact masthead", async () => {
  const html = await readFile("public/sidepanel.html", "utf8");
  const css = await readFile("public/sidepanel.css", "utf8");
  const masthead = html.slice(html.indexOf('<header class="masthead">'), html.indexOf("</header>"));
  const workspace = html.slice(html.indexOf('<section class="workspace"'), html.indexOf("</main>"));

  for (const id of ["followButton", "processButton", "fontSizeButton", "settingsButton"]) {
    assert.match(masthead, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(masthead, /wordmark|video<span>parallel/);
  assert.doesNotMatch(
    html,
    /id="(?:videoTitle|channelName|languageChip|summaryStatus|summaryTitle)"/,
  );
  assert.doesNotMatch(html, /<h2|Content map|简体中文章节概要/);
  assert.match(workspace, /aria-label="全文及章节概要"/);
  assert.match(css, /\.video-overview\s*\{/);
  assert.match(workspace, /id="commandBar"/);
  assert.doesNotMatch(css, /\.command-bar\s*\{[^}]*position:\s*fixed/s);
});
