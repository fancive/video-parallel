# video-parallel

> 在 YouTube 里并排阅读原字幕和 AI 译文，时间轴与播放进度保持同步。

`video-parallel` 是一个本地优先的 Chrome Side Panel 扩展。它直接读取 YouTube
视频已有的字幕轨道，不上传音频，也不依赖字幕中转服务；只有主动开始翻译时，
才会把字幕分批发送给你配置的 OpenAI-compatible Provider。

## MVP 已实现

- 直接读取 YouTube 原生 caption track，优先英文和人工字幕。
- 原文、时间码、译文三轨并排显示。
- 播放时自动高亮并滚动到当前字幕，点击任意字幕可跳转视频。
- 支持 DeepSeek、OpenAI、OpenRouter、Ollama 和自定义 OpenAI-compatible 接口。
- 支持简体中文、繁体中文、日文、韩文、英文、法文、德文和西班牙文。
- 翻译按最多 8 段 / 4000 字符分批请求，逐批写入本地缓存。
- 一键复制或导出包含时间码的 Markdown 对照稿。
- 无开发者后端、无 analytics、无广告、无 telemetry。

## 产品差异

`video-parallel` 不是音频转录器。它把已有字幕变成一条可以跟随播放的对照阅读轨：

```text
ORIGINAL                  TIMECODE                  中文
The first idea...          00:42                    第一个想法是……
The trade-off...           01:08                    代价在于……
```

与 `youtube-digest` 相比，首版不依赖 Supadata，也不锁定 DeepSeek；与
[Obsidian Parallel Reader](https://github.com/fancive/obsidian-parallel-reader) 一样，
核心体验是左右对照、定位联动和可导出的个人资料。

## 安装

```bash
npm install
npm run build
```

然后：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目生成的 `dist/` 目录。
5. 打开设置页，选择 Provider，填写 Base URL、Model 和 API Key。
6. 打开一个有字幕的标准 YouTube `watch` 页面，点击视频操作栏的 **Parallel**。

本地 Ollama 可以使用 `http://localhost:11434/v1`，API Key 留空。

## 隐私与权限

- YouTube host permission：读取当前视频元信息、caption track 和播放时间。
- `sidePanel`：显示对照阅读界面。
- `storage`：在 Chrome 本地保存设置、Key 和翻译缓存。
- `tabs` / `scripting`：只在目标 YouTube 标签页读取播放器状态和执行跳转。
- AI 接口使用 optional host permission；保存设置时只申请当前 Base URL 对应的 origin。

API Key 位于 `chrome.storage.local`，并限制为 trusted extension contexts，但 Chrome
本地存储不是加密密码库。建议使用专用 Key、设置消费上限，不要处理私密或受监管内容。

## 当前边界

- Chrome 116+。
- 只支持标准 `youtube.com/watch` 页面。
- 必须有 YouTube 可读取的原生或自动字幕；不做本地 ASR，也不上传音频转录。
- Provider 必须兼容 `/chat/completions` 和常见 OpenAI JSON 响应格式。
- 当前是开发者模式安装，还没有 Chrome Web Store 自动更新。

## 开发

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run package
```

`npm run package` 生成 `release/video-parallel-v0.1.4.zip`。

## 下一步

- 按视口懒翻译，降低长视频首轮成本。
- 增加字幕搜索、生词收藏和单段重新翻译。
- 增加章节与摘要，但保持它们与字幕对照轨分离。
- 使用 Playwright + Chrome 扩展模式做真实 YouTube E2E。
- 发布 Chrome Web Store 版本与自动更新。

## License

MIT
