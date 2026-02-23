/**
 * Mind Extension - Content Script (精简版)
 * 
 * 只保留保存到 NeoAgent 的核心功能：
 * 1. 划词保存
 * 2. X.com 推文保存
 * 3. Gemini 对话保存
 */

(function () {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    POPUP_HOST_ID: 'mind-selection-popup-host',
    DEFAULT_FOLDER: '00_收集',
  };

  // ==================== 统一 Toast 提示 ====================
  function showToast(message, type = 'success') {
    // 移除已存在的 toast
    const existingToast = document.querySelector('.mind-global-toast');
    if (existingToast) existingToast.remove();

    const colors = {
      success: '#10B981',  // 绿色
      error: '#EF4444',    // 红色
      info: '#6366F1'      // 紫色
    };

    const toast = document.createElement('div');
    toast.className = 'mind-global-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${colors[type] || colors.info};
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    document.body.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ==================== 初始化 ====================
  let selectionPopup = null;

  function init() {

    // 初始化划词浮窗
    initSelectionPopup();

    // 初始化 X.com 集成
    if (isXPage()) {
      initXIntegration();
    }

    // 初始化 Gemini 集成
    if (isGeminiPage()) {
      initGeminiIntegration();
    }

    // 初始化飞书 Wiki 集成
    if (isFeishuWikiPage()) {
      initFeishuIntegration();
    }
  }

  // ==================== 划词保存功能 ====================
  class SelectionPopup {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = CONFIG.POPUP_HOST_ID;
      this.host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';

      this.shadow = this.host.attachShadow({ mode: 'open' });

      // 注入样式
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('styles/selection_popup.css');
      this.shadow.appendChild(link);

      this.container = document.createElement('div');
      this.container.className = 'mind-popup-container';
      this.container.style.display = 'none';
      this.shadow.appendChild(this.container);

      document.body.appendChild(this.host);

      document.addEventListener('mouseup', this.handleMouseUp.bind(this));
      document.addEventListener('mousedown', this.handleMouseDown.bind(this));

      this.selectionText = '';
    }

    handleMouseDown(e) {
      if (!e.composedPath().includes(this.host)) {
        this.hide();
      }
    }

    handleMouseUp(e) {
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (!text || text.length < 2) {
          this.hide();
          return;
        }

        if (!this.isInteractingWithPopup(e)) {
          this.show(selection);
        }
      }, 10);
    }

    isInteractingWithPopup(e) {
      return e.composedPath().includes(this.host);
    }

    show(selection) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      this.container.style.display = 'block';
      this.render();

      const popupRect = this.container.getBoundingClientRect();
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;

      let left = rect.left + scrollX + (rect.width - popupRect.width) / 2;

      // 检测顶部空间是否足够，不够则显示在选中区域下方
      const spaceAbove = rect.top;
      const popupHeight = popupRect.height + 8;
      let top;
      if (spaceAbove >= popupHeight) {
        top = rect.top + scrollY - popupHeight;
      } else {
        top = rect.bottom + scrollY + 8;
      }

      this.setPosition(left, top);
      this.container.style.visibility = 'visible';
      this.selectionText = selection.toString().trim();
    }

    setPosition(left, top) {
      const viewportWidth = window.innerWidth;
      if (left > viewportWidth - 50) {
        left = viewportWidth - 50;
      }
      if (left < 10) {
        left = 10;
      }

      this.container.style.left = `${left}px`;
      this.container.style.top = `${top}px`;
    }

    render() {
      this.container.innerHTML = `
        <div class="mind-selection-toolbar">
          <button class="mind-toolbar-btn btn-save">📝</button>
        </div>
      `;

      this.container.querySelector('.btn-save').onclick = (e) => {
        e.stopPropagation();
        this.handleSave();
      };
    }

    async handleSave() {
      const text = this.selectionText;
      if (!text) return;

      const content = formatContent(text, window.location.href);
      const filename = generateFilename(text);

      const success = await saveToVault(content, filename);
      if (success) {
        showToast(`✅ 已保存: ${filename}`, 'success');
      } else {
        showToast('❌ 保存失败，请检查扩展状态', 'error');
      }
      setTimeout(() => this.hide(), 1500);
    }

    hide() {
      this.container.style.display = 'none';
    }
  }

  function initSelectionPopup() {
    selectionPopup = new SelectionPopup();
  }

  // ==================== X.com (Twitter) 集成 ====================
  function isXPage() {
    return window.location.hostname === 'x.com';
  }

  async function initXIntegration() {
    let debounceTimer = null;
    let stabilityTimer = null;
    const DEBOUNCE_DELAY = 300;
    const STABILITY_TIMEOUT = 10_000; // 10s 无变化后停止 Observer

    const processContent = () => {
      XSaver.addSaveButtons();
    };

    const resetStabilityTimer = () => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => {
        observer.disconnect();
        // Observer 停止后，仍保留 scroll 监听以应对无限滚动
      }, STABILITY_TIMEOUT);
    };

    const debouncedProcess = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processContent, DEBOUNCE_DELAY);
      resetStabilityTimer();
    };

    const observer = new MutationObserver(debouncedProcess);
    observer.observe(document.body, { childList: true, subtree: true });

    // scroll 用于捕获 X.com 无限滚动追加的推文
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        processContent();
        // 滚动说明页面还在活动，重新监听
        if (!observer) return;
        resetStabilityTimer();
      }, 500);
    }, { passive: true });

    // 初始执行
    setTimeout(() => { processContent(); resetStabilityTimer(); }, 1000);
  }

  // ==================== X 保存模块 ====================
  const XSaver = {
    addSaveButtons() {
      const posts = document.querySelectorAll('[data-testid="tweet"]');

      posts.forEach(post => {
        if (post.querySelector('[data-testid="mind-save-btn"]')) return;

        const actionBar = post.querySelector('[role="group"]');
        if (!actionBar) return;

        const saveBtn = this.createSaveButton();
        actionBar.appendChild(saveBtn);

        saveBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.handleSave(post);
        });
      });
    },

    createSaveButton() {
      const button = document.createElement('div');
      button.setAttribute('data-testid', 'mind-save-btn');
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0 12px;
        min-width: 36px;
        min-height: 36px;
        border-radius: 9999px;
        transition: background-color 0.2s;
        color: rgb(113, 118, 123);
      `;
      button.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </div>
      `;

      // Hover 效果
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
        button.style.color = 'rgb(29, 155, 240)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = 'transparent';
        button.style.color = 'rgb(113, 118, 123)';
      });

      return button;
    },

    async handleSave(post) {
      try {

        // 提取主推文内容
        let tweetText = '';
        let articleTitle = '';
        const isArticle = post.querySelector('[data-testid="twitterArticleReadView"]') !== null;

        if (isArticle) {
          const titleElem = post.querySelector('[data-testid="twitter-article-title"]');
          if (titleElem) {
            articleTitle = titleElem.innerText.trim();
            tweetText += `# ${articleTitle}\n\n`;
          }

          const richTextElem = post.querySelector('[data-testid="twitterArticleRichTextView"]');
          if (richTextElem) {
            const blocks = richTextElem.querySelectorAll('[data-block="true"]');
            if (blocks.length > 0) {
              blocks.forEach(block => {
                if (block.tagName.match(/^H[1-6]$/i)) {
                  const level = block.tagName.charAt(1);
                  tweetText += `\n${'#'.repeat(level)} ${block.innerText.trim()}\n\n`;
                } else if (block.tagName.toLowerCase() === 'li') {
                  const isOrdered = block.closest('ol') !== null;
                  tweetText += `${isOrdered ? '1.' : '-'} ${block.innerText.trim()}\n`;
                } else if (block.querySelector('pre')) {
                  const codeElem = block.querySelector('code');
                  const langClass = codeElem ? Array.from(codeElem.classList).find(c => c.startsWith('language-')) : null;
                  const lang = langClass ? langClass.replace('language-', '') : '';
                  const codeText = block.querySelector('pre').innerText.trim();
                  tweetText += `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
                } else if (block.querySelector('[data-testid="tweetPhoto"]')) {
                  // 图片区块由 extractImages 统一处理，此处跳过
                  return;
                } else {
                  const text = block.innerText.trim();
                  if (text) {
                    tweetText += `${text}\n\n`;
                  }
                }
              });
            } else {
              tweetText += richTextElem.innerText;
            }
          }
        } else {
          const textElement = post.querySelector('[data-testid="tweetText"]');
          tweetText = textElement ? textElement.innerText : '';
        }

        // 提取图片
        const images = this.extractImages(post);

        // 提取作者信息
        const authorElement = post.querySelector('[data-testid="User-Name"]');
        const author = authorElement ? authorElement.innerText.split('\n')[0] : '未知作者';

        // 提取时间
        const timeElement = post.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : new Date().toISOString();

        // 提取链接
        const linkElement = post.querySelector('a[href*="/status/"]') || post.querySelector('a[href*="/article/"]');
        const tweetUrl = linkElement ? `https://x.com${linkElement.getAttribute('href')}` : window.location.href;

        // 提取回复内容（包括推文线程）
        let repliesContent = '';
        if (!isArticle) {
          const replies = this.extractReplies(post);
          if (replies.length > 0) {
            // 只保存作者的线程回复
            const threadReplies = replies.filter(r => r.isThread);

            if (threadReplies.length > 0) {
              repliesContent += '\n\n## 推文线程\n\n';
              threadReplies.forEach((reply, index) => {
                repliesContent += `### ${index + 1}. ${reply.text}\n\n`;
                if (reply.images && reply.images.length > 0) {
                  reply.images.forEach((imageUrl, imgIndex) => {
                    repliesContent += `![图片${imgIndex + 1}](${imageUrl})\n\n`;
                  });
                }
              });
            }
          }
        }

        // 构建图片内容
        let imagesContent = '';
        if (images.length > 0) {
          imagesContent = '\n\n## 图片\n\n';
          images.forEach((imageUrl, index) => {
            imagesContent += `![图片${index + 1}](${imageUrl})\n\n`;
          });
        }

        // 提取引用推文
        let quoteContent = '';
        const quoteTweet = post.querySelector('[data-testid="quoteTweet"]') ||
          (post.querySelector('article[aria-labelledby]') !== post ? post.querySelector('article[aria-labelledby]') : null);
        if (quoteTweet && quoteTweet !== post && !isArticle) {
          const quoteTextElem = quoteTweet.querySelector('[data-testid="tweetText"]');
          const quoteAuthorElem = quoteTweet.querySelector('[data-testid="User-Name"]');
          if (quoteTextElem) {
            const quoteText = quoteTextElem.innerText;
            const quoteAuthor = quoteAuthorElem ? quoteAuthorElem.innerText.split('\n')[0] : '未知';
            quoteContent = `\n\n## 引用推文\n\n> **${quoteAuthor}**\n> \n> ${quoteText.split('\n').join('\n> ')}\n`;
          }
        }

        // 构建内容
        const docType = isArticle ? 'X文章' : 'X推文';
        const content = `# ${docType}-${author}\n\n${tweetText}${quoteContent}${imagesContent}${repliesContent}\n\n---\n\n作者: ${author}\n时间: ${timestamp}\n链接: ${tweetUrl}`;

        const displayTitle = (isArticle && articleTitle) ? articleTitle : tweetText.replace(/^#\s.*\n+/, '');
        const filename = generateFilename(`${docType}-${author}-${displayTitle.substring(0, 30)}`);

        const success = await saveToVault(content, filename);
        if (success) {
          showToast(`✅ 已保存: ${filename}`, 'success');
        } else {
          showToast('❌ 保存失败', 'error');
        }
      } catch (error) {
        console.error('[Mind Extension] 保存推文失败:', error);
        showToast('❌ 保存失败', 'error');
      }
    },

    extractImages(element) {
      const images = [];

      try {
        // 方法1: 查找 data-testid="tweetPhoto" 的图片
        const photoElements = element.querySelectorAll('[data-testid="tweetPhoto"]');
        photoElements.forEach(photo => {
          const img = photo.querySelector('img');
          if (img && img.src) {
            // 获取原图链接（去掉缩略图参数）
            const originalUrl = img.src.split('?')[0] + '?format=jpg&name=large';
            images.push(originalUrl);
          }
        });

        // 方法2: 查找所有图片元素（备用）
        if (images.length === 0) {
          const allImages = element.querySelectorAll('img[src*="pbs.twimg.com/media"]');
          allImages.forEach(img => {
            if (img.src && !images.includes(img.src)) {
              const originalUrl = img.src.split('?')[0] + '?format=jpg&name=large';
              images.push(originalUrl);
            }
          });
        }

      } catch (error) {
        console.error('[Mind Extension] 提取图片失败:', error);
      }

      return images;
    },

    extractReplies(post) {
      const replies = [];

      try {
        // 获取主推文的 article 元素
        const mainArticle = post.closest('article') || post;

        // 获取主推文作者（用于区分是否为线程）
        const mainAuthor = post.querySelector('[data-testid="User-Name"]')?.innerText.split('\n')[0];

        // 查找时间线容器（包含对话/线程）
        const timeline = document.querySelector('[aria-label*="Timeline"]') ||
          document.querySelector('[aria-label*="Conversation"]') ||
          document.querySelector('section[role="region"]');

        if (!timeline) {
          return replies;
        }


        // 获取所有推文 article
        const allArticles = timeline.querySelectorAll('article[data-testid="tweet"]');
        let foundCurrent = false;
        let threadCount = 0;
        let normalReplyCount = 0;
        const maxThreadReplies = 50; // 线程推文最多50条
        const maxNormalReplies = 20;  // 其他人回复最多20条


        allArticles.forEach((article, index) => {
          // 直接比较 article 元素
          if (article === mainArticle) {
            foundCurrent = true;
            return;
          }

          // 在当前推文之后的推文
          if (foundCurrent) {
            const replyTextElem = article.querySelector('[data-testid="tweetText"]');
            const replyAuthorElem = article.querySelector('[data-testid="User-Name"]');

            if (replyTextElem && replyAuthorElem) {
              const replyText = replyTextElem.innerText;
              const replyAuthor = replyAuthorElem.innerText.split('\n')[0];

              // 提取回复中的图片
              const replyImages = this.extractImages(article);


              // 如果回复作者与主推文作者相同，说明是推文线程的一部分
              const isThread = replyAuthor === mainAuthor;

              // 分别控制线程和普通回复的数量
              if (isThread && threadCount < maxThreadReplies) {
                replies.push({
                  text: replyText,
                  author: replyAuthor,
                  images: replyImages,
                  isThread: true
                });
                threadCount++;
              } else if (!isThread && normalReplyCount < maxNormalReplies) {
                replies.push({
                  text: replyText,
                  author: replyAuthor,
                  images: replyImages,
                  isThread: false
                });
                normalReplyCount++;
              }

              // 如果线程和回复都收集够了，就停止
              if (threadCount >= maxThreadReplies && normalReplyCount >= maxNormalReplies) {
                return;
              }
            }
          }
        });

      } catch (error) {
        console.error('[Mind Extension] 提取回复失败:', error);
      }

      return replies;
    }
  };

  // ==================== 飞书 Wiki 集成 ====================
  function isFeishuWikiPage() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    return (hostname.includes('feishu.cn') || hostname.includes('larksuite.com')) &&
      pathname.includes('/wiki/');
  }

  function initFeishuIntegration() {
    let debounceTimer = null;
    let stabilityTimer = null;
    const DEBOUNCE_DELAY = 300;
    const STABILITY_TIMEOUT = 10_000;

    const processContent = () => {
      FeishuSaver.addSaveButton();
    };

    const resetStabilityTimer = () => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => observer.disconnect(), STABILITY_TIMEOUT);
    };

    const debouncedProcess = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processContent, DEBOUNCE_DELAY);
      resetStabilityTimer();
    };

    // 监听 DOM 变化（飞书是 SPA）
    const observer = new MutationObserver(debouncedProcess);
    observer.observe(document.body, { childList: true, subtree: true });

    // 初始执行
    setTimeout(() => { processContent(); resetStabilityTimer(); }, 1000);
  }

  // ==================== 飞书 Wiki 保存模块 ====================
  const FeishuSaver = {
    addSaveButton() {
      // 检查是否已添加按钮
      if (document.querySelector('[data-mind-feishu-save-btn]')) return;

      // 查找工具栏 - 顶部右侧操作区域
      const toolbar = document.querySelector('.note-login__btn')?.parentElement ||
        document.querySelector('.more-btn')?.parentElement;

      if (!toolbar) {
        return;
      }

      const saveBtn = this.createSaveButton();
      toolbar.insertBefore(saveBtn, toolbar.firstChild);

      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleSave();
      });
    },

    createSaveButton() {
      const button = document.createElement('button');
      button.setAttribute('data-mind-feishu-save-btn', 'true');
      button.setAttribute('title', '保存到 NeoAgent');
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        margin-right: 12px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        background: #fff;
        color: #333;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      `;
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>保存到 NeoAgent</span>
      `;

      // Hover 效果
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = '#f5f5f5';
        button.style.borderColor = '#d0d0d0';
      });
      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = '#fff';
        button.style.borderColor = '#e0e0e0';
      });

      return button;
    },

    async handleSave() {
      try {
        showToast('📥 正在获取文档内容...', 'info');

        // 提取文档标题
        const titleElement = document.querySelector('.docx-in-wiki h1') ||
          document.querySelector('a.catalogue__item-title.doc-title');
        const title = titleElement ? titleElement.innerText.trim() : '飞书文档';

        // 提取文档内容
        const contentContainer = document.querySelector('.bear-web-x-container.docx-in-wiki');
        if (!contentContainer) {
          showToast('❌ 未找到文档内容', 'error');
          return;
        }

        // 使用智能滚动和内容收集
        const wikiContent = await this.extractWikiContentWithScroll(contentContainer);

        // 构建 Markdown 内容
        const content = `# ${title}\n\n${wikiContent}\n\n---\n\n来源: ${window.location.href}\n时间: ${new Date().toISOString()}`;

        const filename = generateFilename(`飞书Wiki-${title}`);

        const success = await saveToVault(content, filename);
        if (success) {
          showToast(`✅ 已保存: ${filename}`, 'success');
        } else {
          showToast('❌ 保存失败', 'error');
        }
      } catch (error) {
        console.error('[Mind Extension] 保存飞书 Wiki 失败:', error);
        showToast('❌ 保存失败', 'error');
      }
    },

    /**
     * 通过滚动页面来加载所有动态内容，并收集所有文本块
     */
    async extractWikiContentWithScroll(container) {
      console.log('[Mind Extension] 开始收集飞书内容...');

      // 查找正确的滚动容器
      const scrollContainer = this.findScrollContainer(container);
      console.log('[Mind Extension] 找到滚动容器:', scrollContainer);

      // 用于存储已收集的块（使用 data-record-id 去重）
      // 重要：立即提取内容而不是只存储元素引用，因为飞书使用虚拟滚动
      const collectedBlocks = new Map();
      let previousBlockCount = 0;
      let noChangeCount = 0;
      const maxNoChangeAttempts = 3; // 连续3次没有新内容则认为已加载完成

      // 滚动函数
      const scrollToBottom = () => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          console.log('[Mind Extension] 滚动到:', scrollContainer.scrollTop, '/', scrollContainer.scrollHeight);
        } else {
          window.scrollTo(0, document.body.scrollHeight);
          console.log('[Mind Extension] 使用 window 滚动');
        }
      };

      // 收集当前可见的所有文本块
      const collectBlocks = () => {
        // 查找所有带 data-record-id 的文本块
        const textBlocks = document.querySelectorAll('div.block.docx-text-block[data-record-id]');
        console.log('[Mind Extension] 当前找到的文本块数量:', textBlocks.length);

        textBlocks.forEach(block => {
          const recordId = block.getAttribute('data-record-id');
          if (recordId && !collectedBlocks.has(recordId)) {
            // 立即提取内容，避免虚拟滚动导致元素被移除
            const content = this.extractBlockContent(block);
            const blockType = block.getAttribute('data-block-type') || 'text';

            collectedBlocks.set(recordId, {
              id: recordId,
              content: content,
              type: blockType,
              order: collectedBlocks.size // 保持顺序
            });

            console.log('[Mind Extension] 新块:', recordId, '类型:', blockType, '内容长度:', content?.length || 0);
          }
        });

        console.log('[Mind Extension] 已收集块数量:', collectedBlocks.size);
        return collectedBlocks.size;
      };

      // 初始收集
      const initialCount = collectBlocks();
      console.log('[Mind Extension] 初始收集到', initialCount, '个块');

      // 滚动并收集内容
      while (noChangeCount < maxNoChangeAttempts) {
        scrollToBottom();

        // 等待内容加载
        await new Promise(resolve => setTimeout(resolve, 800));

        const currentBlockCount = collectBlocks();

        if (currentBlockCount === previousBlockCount) {
          noChangeCount++;
          console.log('[Mind Extension] 无新内容，计数:', noChangeCount);
        } else {
          noChangeCount = 0;
          previousBlockCount = currentBlockCount;
          console.log('[Mind Extension] 发现新内容，总计:', currentBlockCount);
        }
      }

      console.log('[Mind Extension] 收集完成，总共', collectedBlocks.size, '个块');

      // 滚动回顶部
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      } else {
        window.scrollTo(0, 0);
      }

      // 将收集的块按顺序排序并组装内容
      const sortedBlocks = Array.from(collectedBlocks.values())
        .sort((a, b) => a.order - b.order);

      let markdown = '';
      for (const blockInfo of sortedBlocks) {
        if (blockInfo.content) {
          markdown += blockInfo.content + '\n\n';
        }
      }

      // 如果提取结果为空，使用简单提取方法
      if (!markdown.trim()) {
        console.log('[Mind Extension] 智能提取失败，使用简单提取');
        return this.extractSimpleContent(container);
      }

      console.log('[Mind Extension] 最终内容长度:', markdown.length, '字符');
      return markdown.trim();
    },

    /**
     * 查找飞书页面的滚动容器
     */
    findScrollContainer(startElement) {
      // 飞书常见的滚动容器选择器
      const possibleSelectors = [
        '.bear-web-x-container',
        '.docx-in-wiki',
        '[class*="scroll"]',
        '[class*="content-container"]',
        'main',
        '[role="main"]'
      ];

      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element && this.isScrollable(element)) {
          console.log('[Mind Extension] 找到可滚动容器:', selector);
          return element;
        }
      }

      // 如果没找到，尝试从当前元素向上查找可滚动的父元素
      let current = startElement;
      while (current && current !== document.body) {
        if (this.isScrollable(current)) {
          console.log('[Mind Extension] 找到父级可滚动容器');
          return current;
        }
        current = current.parentElement;
      }

      console.log('[Mind Extension] 未找到自定义滚动容器，使用 window');
      return null;
    },

    /**
     * 检查元素是否可滚动
     */
    isScrollable(element) {
      const style = window.getComputedStyle(element);
      const overflowY = style.overflowY;
      const hasScroll = element.scrollHeight > element.clientHeight;
      return (overflowY === 'auto' || overflowY === 'scroll') && hasScroll;
    },

    extractWikiContent(container) {
      let markdown = '';

      // 获取所有块级元素
      const blocks = container.querySelectorAll('div[data-zone-id], div.block');

      if (blocks.length === 0) {
        // 如果没有找到块，尝试直接提取文本
        return this.extractSimpleContent(container);
      }

      // 遍历所有块
      blocks.forEach(block => {
        const blockContent = this.extractBlockContent(block);
        if (blockContent) {
          markdown += blockContent + '\n\n';
        }
      });

      // 如果提取结果为空，使用简单提取方法
      if (!markdown.trim()) {
        return this.extractSimpleContent(container);
      }

      return markdown.trim();
    },

    extractBlockContent(block) {
      // 检查是否是标题
      const headingMatch = block.className?.match(/docx-heading(\d)/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]) + 1; // H1 通常保留给文档标题
        const text = block.innerText?.trim();
        if (text) {
          return `${'#'.repeat(level)} ${text}`;
        }
      }

      // 检查是否是代码块
      if (block.classList?.contains('docx-codeblock-container') ||
        block.querySelector('pre, code')) {
        const codeElement = block.querySelector('pre, code') || block;
        const code = codeElement.innerText?.trim();
        if (code) {
          return '```\n' + code + '\n```';
        }
      }

      // 检查是否是图片
      const img = block.querySelector('img');
      if (img && img.src) {
        const alt = img.alt || '图片';
        return `![${alt}](${img.src})`;
      }

      // 检查是否是列表项
      if (block.querySelector('ul, ol')) {
        return this.extractList(block);
      }

      // 普通段落
      const text = block.innerText?.trim();
      if (text && text.length > 0) {
        // 跳过可能是UI元素的短文本
        if (text.length < 2) return '';
        return text;
      }

      return '';
    },

    extractList(container) {
      let result = '';
      const listItems = container.querySelectorAll('li');

      listItems.forEach((item, index) => {
        const text = item.innerText?.trim();
        if (text) {
          // 检查是有序还是无序列表
          const isOrdered = item.closest('ol') !== null;
          const prefix = isOrdered ? `${index + 1}. ` : '- ';
          result += prefix + text + '\n';
        }
      });

      return result;
    },

    extractSimpleContent(container) {
      // 简单提取方法：遍历所有可见文本
      let content = '';

      // 提取所有段落
      const paragraphs = container.querySelectorAll('p, div');
      paragraphs.forEach(p => {
        const text = p.innerText?.trim();
        if (text && text.length > 2) {
          content += text + '\n\n';
        }
      });

      // 提取图片
      const images = container.querySelectorAll('img');
      images.forEach(img => {
        if (img.src) {
          const alt = img.alt || '图片';
          content += `![${alt}](${img.src})\n\n`;
        }
      });

      return content.trim();
    }
  };

  // ==================== Gemini 集成 ====================
  function isGeminiPage() {
    return window.location.hostname === 'gemini.google.com';
  }

  function initGeminiIntegration() {

    const observer = new MutationObserver(() => {
      GeminiSaver.addSaveButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => GeminiSaver.addSaveButtons(), 1000);
  }

  // ==================== Gemini 保存模块 ====================
  const GeminiSaver = {
    addSaveButtons() {
      // 1. 在菜单中添加"保存全部对话"按钮
      this.addMenuSaveButton();

      // 2. 在每个回答区域添加独立保存按钮
      this.addResponseSaveButtons();
    },

    // 在每个 Gemini 回答区域添加保存按钮
    addResponseSaveButtons() {
      // 查找所有 Gemini 回答区域
      const responses = document.querySelectorAll('model-response');

      responses.forEach(response => {
        // 跳过已添加保存按钮的区域
        if (response.querySelector('[data-mind-save-response-btn]')) return;

        // 查找工具栏（复制按钮所在的区域）
        const toolbar = response.querySelector('.response-actions, [class*="action"], .buttons-container');

        // 创建保存按钮
        const saveBtn = this.createResponseSaveButton();

        if (toolbar) {
          // 插入到工具栏
          toolbar.appendChild(saveBtn);
        } else {
          // 如果没有工具栏，创建一个浮动按钮
          saveBtn.style.position = 'absolute';
          saveBtn.style.top = '8px';
          saveBtn.style.right = '8px';
          response.style.position = 'relative';
          response.appendChild(saveBtn);
        }

        // 添加点击事件
        saveBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.handleSaveSingle(response);
        });

        // Hover 回答区域时才显示按钮
        response.addEventListener('mouseenter', () => {
          saveBtn.style.opacity = '1';
          saveBtn.style.pointerEvents = 'auto';
        });
        response.addEventListener('mouseleave', () => {
          saveBtn.style.opacity = '0';
          saveBtn.style.pointerEvents = 'none';
        });
      });
    },

    // 创建回答区域的保存按钮
    createResponseSaveButton() {
      const button = document.createElement('button');
      button.setAttribute('data-mind-save-response-btn', 'true');
      button.setAttribute('title', '保存');
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 12px;
        border: none;
        border-radius: 16px;
        background: transparent;
        color: rgb(95, 99, 104);
        font-size: 13px;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition: background-color 0.2s, color 0.2s, opacity 0.15s;
      `;
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        <span>保存</span>
      `;

      // Hover 效果
      button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
        button.style.color = 'rgb(66, 133, 244)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = 'transparent';
        button.style.color = 'rgb(95, 99, 104)';
      });

      return button;
    },

    // 在菜单中添加"保存全部对话"按钮
    addMenuSaveButton() {
      const menus = document.querySelectorAll('.mat-mdc-menu-panel.conversation-actions-menu');

      menus.forEach(menu => {
        // 跳过已添加保存按钮的菜单
        if (menu.querySelector('[data-mind-save-all-btn]')) return;

        const menuContent = menu.querySelector('.mat-mdc-menu-content');
        if (!menuContent) return;

        // 创建保存按钮
        const saveBtn = this.createMenuButton();

        // 插入到菜单的第一项（在"分享对话内容"之前）
        const firstButton = menuContent.querySelector('button');
        if (firstButton) {
          menuContent.insertBefore(saveBtn, firstButton);
        } else {
          menuContent.appendChild(saveBtn);
        }

        // 添加点击事件
        saveBtn.addEventListener('click', () => {
          this.handleSaveAll();
          // 关闭菜单
          menu.style.display = 'none';
        });
      });
    },

    createMenuButton() {
      const button = document.createElement('button');
      button.setAttribute('mat-menu-item', '');
      button.setAttribute('data-mind-save-all-btn', 'true');
      button.setAttribute('data-test-id', 'mind-save-all-button');
      button.className = 'mat-mdc-menu-item mat-focus-indicator ng-star-inserted';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-disabled', 'false');

      button.innerHTML = `
        <mat-icon role="img" fonticon="save" class="mat-icon notranslate menu-icon google-symbols mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font" data-mat-icon-name="save">save</mat-icon>
        <span class="mat-mdc-menu-item-text"><span class="menu-text">保存全部对话</span></span>
        <div matripple="" class="mat-ripple mat-mdc-menu-ripple"></div>
      `;

      return button;
    },

    // 保存全部对话
    async handleSaveAll() {
      try {

        // 获取对话内容 - 尝试多种选择器
        let content = '# Gemini 完整对话\n\n';
        let foundMessages = false;

        // 方法1: 尝试查找 message-content 类
        const messageContainers = document.querySelectorAll('.message-content, [class*="message"], [class*="conversation-turn"]');

        if (messageContainers.length > 0) {

          messageContainers.forEach((msg, index) => {
            const text = msg.innerText?.trim();
            if (text && text.length > 0) {
              // 尝试判断是用户还是AI的消息
              const isUser = msg.closest('[data-test-id*="user"]') ||
                msg.classList.toString().includes('user') ||
                index % 2 === 0;

              const role = isUser ? '👤 用户' : '🤖 Gemini';
              content += `## ${role}\n\n${text}\n\n`;
              foundMessages = true;
            }
          });
        }

        // 方法2: 如果没找到，尝试获取整个对话区域
        if (!foundMessages) {
          const conversationArea = document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.body;

          if (conversationArea) {
            const text = conversationArea.innerText;
            content += text + '\n\n';
          }
        }

        content += `\n---\n\n时间: ${new Date().toISOString()}\n来源: ${window.location.href}`;


        const filename = generateFilename('Gemini完整对话');
        const success = await saveToVault(content, filename);
        if (success) {
          showToast(`✅ 已保存: ${filename}`, 'success');
        } else {
          showToast('❌ 保存失败', 'error');
        }
      } catch (error) {
        console.error('[Mind Extension] 保存全部对话失败:', error);
        showToast('❌ 保存失败', 'error');
      }
    },

    // 保存单次会话（一问一答）
    async handleSaveSingle(responseElement) {
      try {

        // 获取 Gemini 的回答
        const responseText = responseElement.innerText?.trim() || '';

        // 尝试查找对应的用户问题
        // 通常用户问题在回答的前面
        let userQuestion = '';

        // 方法1: 查找前一个兄弟元素
        let prevElement = responseElement.previousElementSibling;
        while (prevElement) {
          if (prevElement.classList.toString().includes('user') ||
            prevElement.getAttribute('data-test-id')?.includes('user')) {
            userQuestion = prevElement.innerText?.trim() || '';
            break;
          }
          prevElement = prevElement.previousElementSibling;
        }

        // 方法2: 查找父容器中的用户消息
        if (!userQuestion) {
          const container = responseElement.closest('[class*="conversation"], [class*="turn-container"]');
          if (container) {
            const userMsg = container.querySelector('[class*="user"]');
            if (userMsg) {
              userQuestion = userMsg.innerText?.trim() || '';
            }
          }
        }

        // 构建内容
        let content = '# Gemini 对话片段\n\n';

        if (userQuestion) {
          content += `## 👤 用户\n\n${userQuestion}\n\n`;
        }

        // 使用保留代码块格式的提取方式
        const responseMarkdown = extractGeminiContent(responseElement);
        content += `## 🤖 Gemini\n\n${responseMarkdown}\n\n`;
        content += `\n---\n\n时间: ${new Date().toISOString()}\n来源: ${window.location.href}`;


        const filename = generateFilename('Gemini对话片段');
        const success = await saveToVault(content, filename);
        if (success) {
          showToast(`✅ 已保存: ${filename}`, 'success');
        } else {
          showToast('❌ 保存失败', 'error');
        }
      } catch (error) {
        console.error('[Mind Extension] 保存单次会话失败:', error);
        showToast('❌ 保存失败', 'error');
      }
    }
  };

  // ==================== 工具函数 ====================

  /**
   * 从 Gemini 响应元素提取内容，保留代码块格式
   */
  function extractGeminiContent(element) {
    let result = '';

    // 查找所有代码块
    const codeBlocks = element.querySelectorAll('pre, code-block, .code-block');

    if (codeBlocks.length === 0) {
      // 没有代码块，直接返回文本
      return element.innerText?.trim() || '';
    }

    // 递归处理子元素
    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent;
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tagName = node.tagName?.toLowerCase();

      // 处理代码块
      if (tagName === 'pre' || node.classList?.contains('code-block')) {
        const codeElem = node.querySelector('code') || node;
        const code = codeElem.textContent?.trim() || '';
        // 尝试获取语言
        const langClass = codeElem.className?.match(/language-(\w+)/);
        const lang = langClass ? langClass[1] : '';
        result += `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        return;
      }

      // 处理列表
      if (tagName === 'ul' || tagName === 'ol') {
        result += '\n';
        const items = node.querySelectorAll(':scope > li');
        items.forEach((li, index) => {
          const prefix = tagName === 'ol' ? `${index + 1}. ` : '- ';
          result += `${prefix}${li.textContent?.trim()}\n`;
        });
        result += '\n';
        return;
      }

      // 处理段落
      if (tagName === 'p') {
        result += `\n${node.textContent?.trim()}\n`;
        return;
      }

      // 处理标题
      if (/^h[1-6]$/.test(tagName)) {
        const level = parseInt(tagName[1]);
        result += `\n${'#'.repeat(level)} ${node.textContent?.trim()}\n\n`;
        return;
      }

      // 处理行内代码
      if (tagName === 'code' && node.parentElement?.tagName?.toLowerCase() !== 'pre') {
        result += `\`${node.textContent}\``;
        return;
      }

      // 递归处理子节点
      for (const child of node.childNodes) {
        processNode(child);
      }
    }

    processNode(element);

    // 清理多余空行
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatContent(text, url) {
    const title = text.length > 50 ? text.substring(0, 50) + '...' : text;
    return `# ${title}\n\n${text}\n\n---\n\n来源: ${url}\n时间: ${new Date().toISOString()}`;
  }

  function generateFilename(text) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');

    // 清理文本作为文件名
    let cleanText = text
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    if (!cleanText) {
      cleanText = '摘抄';
    }

    return `${cleanText}-${dateStr}.md`;
  }

  async function saveToVault(content, filename) {
    try {

      const response = await chrome.runtime.sendMessage({
        action: 'saveToVault',
        content: content,
        filename: filename
      });


      if (response && response.success) {
        return true;
      } else {
        console.error('[Mind Extension] ❌ 保存失败:', response?.error || 'No response');
        return false;
      }
    } catch (error) {
      console.error('[Mind Extension] 保存到 NeoAgent 失败:', error);
      return false;
    }
  }

  // ==================== 启动 ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
    });
  } else {
    init();
  }
})();
