module.exports = {
    apps: [
        {
            name: 'NeoAgent-bot',
            script: './dist/telegram-bot.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './logs/bot-error.log',
            out_file: './logs/bot-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss'
        }
    ]
};
