# Web Voice Input — Dev Plan

## Status: ✅ Implemented (2026-05-12)

## Overview

实现 Web Chat 语音输入能力（Phase 1 MVP）。

## 实现范围

### 后端

#### `src/services/transcription.ts`（新增）

统一语音转写服务，优先调用 OpenAI Whisper，无 OpenAI key 时 fallback 到 Gemini 1.5 Flash 多模态转写。

接口：
```ts
transcribeAudio(opts: TranscribeOptions): Promise<string>
```

支持的 MIME type：`audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/flac`, `audio/m4a`, `video/webm`, `video/mp4`。

单次上限：25MB（Whisper 限制）。

#### `src/routes/transcribe.ts`（新增）

```
POST /api/transcribe  (multipart/form-data)
```

- `audio` 字段：音频文件 Blob
- 响应：`{ text: string }`
- 错误：400（无音频）/ 413（超大）/ 415（不支持格式）/ 503（转写失败/无 provider）
- 自动注册（通过 `autoLoad` 路由发现机制），无需手动挂载

### 前端

#### `packages/web/src/api.ts`

新增 `transcribeAudio(blob: Blob, filename?: string): Promise<string>`，调用 `POST /api/transcribe`。

#### `packages/web/src/components/ChatArea.tsx`

`ChatInput` 组件内新增：

- 引入 `Mic`, `MicOff` 图标（lucide-react）
- 录音状态机：`idle | recording | transcribing`
- `handleVoiceClick()`：
  - idle → 请求麦克风权限 → 初始化 `MediaRecorder` → 录音
  - recording → 停止 `MediaRecorder` → 触发 `onstop` → 转写 → 插入输入框
  - transcribing → 忽略点击
- 底栏右侧（Send 按钮左侧）新增 mic 按钮，生成中时隐藏
- 输入区底部新增状态条：录音中（含计时、取消）/ 转写中 / 错误提示
- 最大录音 90 秒，超时自动停止

#### `packages/web/src/i18n/locales/en.ts` / `zh.ts`

新增 `voiceInput`, `voiceRecording`, `voiceTranscribing`, `voiceCancel`, `voiceStop`, `voiceErrorNoSupport`, `voiceErrorPermission`, `voiceErrorInsecure`, `voiceErrorNoProvider`, `voiceErrorTooLong`, `voiceErrorGeneric` 共 11 个 key。

## 错误路径覆盖

| 场景 | 提示 |
|------|------|
| 浏览器不支持 MediaRecorder | `voiceErrorNoSupport` |
| 非安全上下文（非 HTTPS/localhost）| `voiceErrorInsecure` |
| 麦克风权限被拒绝 | `voiceErrorPermission` |
| 无配置 OpenAI / Gemini key | `voiceErrorNoProvider` |
| 转写失败（网络、超时等）| `voiceErrorGeneric` |

## 音频格式策略

浏览器 `MediaRecorder` 使用 `isTypeSupported` 自动选择第一个支持的格式：
1. `audio/webm;codecs=opus`（Chrome/Edge）
2. `audio/webm`
3. `audio/ogg;codecs=opus`（Firefox）
4. `audio/ogg`
5. `audio/mp4`（Safari 偏好，但 Safari 下实际常为 mp4）

后端 transcribe 路由允许以上所有格式以及 `video/webm`（Chrome 有时用此 MIME）。

## 验证记录

- `npm run build`：通过（后端 tsc）
- `npm --workspace neo-web run build`：通过（前端 vite build）
- `npm run docs:check`：通过

## 待办 / 已知限制

- 原始音频不保存，仅保留转写文本（设计决策，见 PRD Non-goals）
- Safari 下 `audio/mp4` 转写质量依赖 OpenAI Whisper；Gemini fallback 支持同等格式
- 实时听写（edge streaming）、自动发送偏好、转写语言手动指定 等 Phase 2 特性待后续迭代
