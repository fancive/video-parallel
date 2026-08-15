# video-parallel

> 把 YouTube 字幕变成可随播放跳转的 AI 章节概要。

`video-parallel` 是一个本地优先的 Chrome Side Panel 扩展。它直接读取 YouTube
视频已有的字幕轨道，不上传音频，也不依赖字幕中转服务。只有主动点击“开始处理”时，
才会把完整字幕发送给你配置的 OpenAI-compatible Provider。

## 已实现

- 直接读取 YouTube 原生 caption track，优先英文和人工字幕。
- 让模型根据话题、论证和叙事转折划分章节，不使用固定时间间隔切分。
- 每章包含标题、2–3 句摘要、关键点和可点击的起止时间。
- 播放时自动高亮并滚动到当前章节，点击章节卡可跳转视频。
- 支持 DeepSeek、OpenAI、OpenRouter、Ollama 和自定义 OpenAI-compatible 接口。
- 支持简体中文、繁体中文、日文、韩文、英文、法文、德文和西班牙文概要。
- 章节结构与概要按视频、语言、接口、模型和提示词版本独立缓存。
- 一键复制或导出包含时间码的 Markdown 概要。
- 无开发者后端、无 analytics、无广告、无 telemetry。

## 工作流程

```text
YouTube caption track
        ↓
完整字幕 + 稳定 segment id + 时间戳
        ↓
模型同时完成目标语言转换、语义切章和概要
        ↓
可跳转章节卡片 + 本地缓存 + Markdown
```

代码只校验模型返回的章节起点是否来自真实字幕，并据此保证章节连续、无重叠、覆盖完整视频。
当前单次智能处理上限为 2000 个字幕段或 100,000 字符；超过时会明确报错，不会静默退回机械切分。

## 快捷键

- `Alt+Shift+P`：打开或关闭当前 YouTube 视频的侧边栏。
- `Alt+Shift+S`：打开侧边栏并开始处理当前视频。

可以在 `chrome://extensions/shortcuts` 修改快捷键。

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
6. 打开一个有字幕的标准 YouTube `watch` 页面，点击视频操作栏的“概要”。

本地 Ollama 可以使用 `http://localhost:11434/v1`，API Key 留空。

## 隐私与权限

- YouTube host permission：读取当前视频元信息、caption track 和播放时间。
- `sidePanel`：显示章节概要界面。
- `storage`：在 Chrome 本地保存设置、Key 和概要缓存。
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

`npm run package` 生成 `release/video-parallel-v0.1.5.zip`。

## 下一步

- 对超长视频增加分层式模型切章，而不是机械分块。
- 支持复用视频原生章节，并允许手动调整模型边界。
- 使用 Playwright + Chrome 扩展模式做真实 YouTube E2E。
- 发布 Chrome Web Store 版本与自动更新。

## License

MIT
