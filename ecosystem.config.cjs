module.exports = {
    apps: [
        {
            name: 'inkClaw-bot',
            script: './dist/telegram-bot.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
                // Path to system Chrome for browser_fetch skill (Puppeteer)
                // macOS default shown; change for Linux: /usr/bin/google-chrome-stable
                CHROME_PATH: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                // If Chrome is already running with --remote-debugging-port, connect to it instead
                // of launching a new instance (no flash, real cookies, faster).
                // Start Chrome with: open -a "Google Chrome" --args --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/inkClaw-chrome
                BROWSER_CDP_PORT: process.env.BROWSER_CDP_PORT ?? '9222',
            },
            error_file: './logs/bot-error.log',
            out_file: './logs/bot-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss'
        }
    ]
};
