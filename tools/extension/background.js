/**
 * Mind Extension - Background Script（精简版）
 * 只保留文件下载功能
 */

// 扩展安装或更新时
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Mind Extension] Extension installed');
  } else if (details.reason === 'update') {
    console.log(`[Mind Extension] Extension updated to version ${chrome.runtime.getManifest().version}`);
  }
});

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Mind Extension] Received message', { action: request.action, sender: sender.tab?.id });

  // 处理保存到 NeoAgent vault 的请求
  if (request.action === 'saveToVault') {
    const { content, filename } = request;

    console.log('[Mind Extension] 开始下载:', { filename, contentLength: content?.length });

    // 将内容转换为 base64 编码的 data URL
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:text/markdown;base64,${base64Content}`;

    // 下载到 Downloads/NeoAgent/00_收集/ 目录（与 vault 入口保持一致）
    const downloadPath = `NeoAgent/00_收集/${filename}`;

    console.log('[Mind Extension] Download path:', downloadPath);

    chrome.downloads.download({
      url: dataUrl,
      filename: downloadPath,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Mind Extension] Download failed:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[Mind Extension] Download started:', downloadId);
        sendResponse({ success: true, downloadId: downloadId });
      }
    });

    return true;
  }

  // 处理 ping 测试
  if (request.action === 'ping') {
    sendResponse({ success: true, message: 'pong' });
    return true;
  }

  // 未知消息
  sendResponse({ success: false, error: 'Unknown action' });
  return true;
});

console.log('[Mind Extension] Background script loaded');
