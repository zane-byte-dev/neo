# 浏览器扩展使用指南

`extension/` 目录包含 Neo Clipper Chrome 扩展。它目前以本地下载为主：把网页内容保存为 Markdown 文件到 `Downloads/neo/inbox/`，再由用户手动整理到 workspace 或 Notebook。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择仓库中的 `extension/` 目录。

## 权限

| 权限 | 用途 |
|------|------|
| `activeTab` | 读取当前页面选区和上下文 |
| `downloads` | 把 Markdown 保存到 `Downloads/neo/inbox/` |
| `storage` | 保存扩展内部状态 |
| `<all_urls>` | 在普通网页、X.com、Gemini、飞书 Wiki 等页面注入保存按钮 |

## 支持场景

| 场景 | 操作 | 输出 |
|------|------|------|
| 普通网页 | 选中文本后点击浮窗保存按钮 | Markdown |
| X.com | 点击推文保存按钮 | 推文、线程、引用推文和图片信息 |
| Gemini | 点击回答区域保存按钮 | 对话 Markdown，保留代码块 |
| 飞书 Wiki | 点击页面右上角「保存到 Neo」 | 文档 Markdown，尽量保留标题、图片、代码块、列表 |

## 保存路径

Chrome 会下载到：

```text
~/Downloads/neo/inbox/
```

建议定期把其中有价值的 Markdown 移入 `{workDir}/notebooks/<notebook>/`，或通过 Notebook 导入流程归档。

## 排查

- 没有按钮：刷新页面，确认扩展已启用且目标页面匹配 `<all_urls>`。
- 下载失败：检查 Chrome 是否允许该扩展下载文件。
- 内容不完整：部分站点懒加载严重，先滚动到需要保存的区域再点击保存。
- 想接入 Neo 服务端：当前扩展没有服务地址配置 UI，服务端直传仍是后续增强方向。