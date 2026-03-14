/**
 * browser-service.ts — Singleton Puppeteer browser for JS-rendered page fetching.
 *
 * Connection strategy (tried in order):
 *   1. Reuse the existing singleton browser instance if still connected.
 *   2. Connect via CDP to a Chrome already running with --remote-debugging-port=9222.
 *      Start Chrome that way with: BROWSER_CDP_PORT=9222 (see ecosystem.config.js).
 *      No window flash, near-zero startup, real cookies available.
 *   3. Launch a new headless Chrome as a fallback.
 *
 * Environment variables:
 *   CHROME_PATH          Path to Chrome binary (default: macOS app path)
 *   BROWSER_CDP_PORT     Port of an already-running Chrome with remote debugging (default: 9222)
 *   BROWSER_HEADLESS     Set to "false" to show the Chrome window (debug mode)
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';

const CHROME_PATH =
    process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CDP_PORT = parseInt(process.env.BROWSER_CDP_PORT ?? '9222', 10);

let browserInstance: Browser | null = null;
/** true when browserInstance was obtained via connect() — must NOT call browser.close() */
let isCdpConnected = false;

/**
 * Try to connect to a Chrome instance already running with --remote-debugging-port.
 * Returns null if no such instance is reachable.
 */
async function tryConnectCdp(): Promise<Browser | null> {
    try {
        const res = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
            signal: AbortSignal.timeout(800),
        });
        if (!res.ok) return null;
        const { webSocketDebuggerUrl } = await res.json() as { webSocketDebuggerUrl?: string };
        if (!webSocketDebuggerUrl) return null;
        const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
        console.log(`[BrowserService] Connected to existing Chrome via CDP (port ${CDP_PORT})`);
        return browser;
    } catch {
        return null;
    }
}

async function getBrowser(): Promise<Browser> {
    if (browserInstance && browserInstance.connected) return browserInstance;

    // 1. Try CDP connect to pre-running Chrome (no flash, real cookies, fast)
    const cdp = await tryConnectCdp();
    if (cdp) {
        browserInstance = cdp;
        isCdpConnected = true;
        browserInstance.on('disconnected', () => { browserInstance = null; isCdpConnected = false; });
        return browserInstance;
    }

    // 2. Fallback: launch a new headless Chrome
    isCdpConnected = false;
    // Set BROWSER_HEADLESS=false to show the Chrome window (useful for debugging)
    const headless = process.env.BROWSER_HEADLESS !== 'false';

    browserInstance = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,800',
            // Chrome 112+ "new headless" briefly creates a native macOS window before hiding it.
            // Moving it off-screen prevents the visual flash.
            '--window-position=-10000,-10000',
            // Expose a debug port so subsequent calls can reuse this instance via CDP
            `--remote-debugging-port=${CDP_PORT}`,
        ],
    });
    console.log(`[BrowserService] Launched new Chrome (headless=${headless})`);

    browserInstance.on('disconnected', () => { browserInstance = null; isCdpConnected = false; });
    return browserInstance;
}

export async function closeBrowser(): Promise<void> {
    if (browserInstance) {
        if (isCdpConnected) {
            // Only disconnect — do NOT close the external Chrome the user may be running
            browserInstance.disconnect();
        } else {
            await browserInstance.close().catch(() => {});
        }
        browserInstance = null;
        isCdpConnected = false;
    }
}

/**
 * Fetch a URL using a real Chrome browser.
 * Waits for JS to render, then returns cleaned plain text.
 *
 * @param url       Full URL to fetch
 * @param maxChars  Max characters to return (default 8000)
 * @param timeoutMs Navigation timeout in ms (default 20000)
 */
export async function browserFetch(
    url: string,
    maxChars = 8_000,
    timeoutMs = 20_000,
): Promise<string> {
    let page: Page | null = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Realistic UA to avoid bot detection
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/145.0.0.0 Safari/537.36',
        );

        // Block images/fonts/media to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeoutMs,
        });

        // Extract clean readable text from the rendered DOM
        // (runs inside Chrome — DOM types don't exist in this Node tsconfig, hence `any` cast)
        const text: string = await page.evaluate(() => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const doc = (globalThis as any).document;
            const remove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript'];
            remove.forEach((tag: string) => {
                doc.querySelectorAll(tag).forEach((el: any) => el.remove());
            });
            return (doc.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim() as string;
        });

        return text.length > maxChars
            ? text.slice(0, maxChars) + `\n\n[...已截断，还有 ${text.length - maxChars} 个字符]`
            : text;

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Avoid leaking internal paths in error messages
        return `[Error] browser_fetch: ${msg.replace(CHROME_PATH, '<chrome>')}`;
    } finally {
        await page?.close().catch(() => {});
    }
}
