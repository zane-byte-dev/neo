use teloxide::prelude::*;
use teloxide::utils::command::BotCommands;
use std::env;
use crate::genai;

#[derive(BotCommands, Clone)]
#[command(rename_rule = "lowercase", description = "NeoAgent Bot Commands:")]
enum Command {
    #[command(description = "显示帮助信息")]
    Help,
    #[command(description = "启动 Bot")]
    Start,
    #[command(description = "执行技能: /run <skill_name> [args]")]
    Run(String),
}

pub async fn run_bot() {
    let token = env::var("TELEGRAM_BOT_TOKEN").expect("TELEGRAM_BOT_TOKEN must be set");
    let bot = Bot::new(token);

    println!("[System] Telegram Bot starting...");

    let handler = Update::filter_message()
        .branch(dptree::entry().filter_command::<Command>().endpoint(commands_handler))
        .branch(dptree::endpoint(message_handler));

    Dispatcher::builder(bot, handler)
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
}

async fn commands_handler(bot: Bot, msg: Message, cmd: Command) -> ResponseResult<()> {
    if !is_authorized(&msg) {
        bot.send_message(msg.chat.id, "⛔ Unauthorized.").await?;
        return Ok(());
    }

    match cmd {
        Command::Help | Command::Start => {
            bot.send_message(msg.chat.id, Command::descriptions().to_string()).await?;
        }
        Command::Run(args_str) => {
            let parts: Vec<&str> = args_str.split_whitespace().collect();
            if parts.is_empty() {
                bot.send_message(msg.chat.id, "Usage: /run <skill_name> [args]").await?;
                return Ok(());
            }

            let skill_name = parts[0];
            let extra_args = parts[1..].iter().map(|s| s.to_string()).collect();

            bot.send_message(msg.chat.id, format!("💭 正在执行技能 [{}]...", skill_name)).await?;

            match genai::run_skill(skill_name, extra_args).await {
                Ok(response) => {
                    bot.send_message(msg.chat.id, response).await?;
                }
                Err(e) => {
                    bot.send_message(msg.chat.id, format!("🔥 技能执行失败: {}", e)).await?;
                }
            }
        }
    }

    Ok(())
}

async fn message_handler(bot: Bot, msg: Message) -> ResponseResult<()> {
    if !is_authorized(&msg) {
        bot.send_message(msg.chat.id, "⛔ Unauthorized.").await?;
        return Ok(());
    }

    if let Some(text) = msg.text() {
        bot.send_chat_action(msg.chat.id, teloxide::types::ChatAction::Typing).await?;
        
        // For now, let's treat general chat as a skill call to "chat" or just a direct Gemini call
        // Since we don't have a dedicated "chat" skill yet, we can either implement one 
        // or just use a default prompt. For integration, let's try calling "chat" skill if it exists.
        match genai::run_skill("chat", vec![text.to_string()]).await {
            Ok(response) => {
                bot.send_message(msg.chat.id, response).await?;
            }
            Err(_) => {
                // If "chat" skill doesn't exist, we could fall back to a simple Gemini call
                // but for now let's just say we need a skill.
                bot.send_message(msg.chat.id, "请使用 /run <skill> 或创建 chat 技能。").await?;
            }
        }
    }

    Ok(())
}

fn is_authorized(msg: &Message) -> bool {
    let authorized_id = env::var("TELEGRAM_CHAT_ID")
        .ok()
        .and_then(|s| s.parse::<i64>().ok());

    match authorized_id {
        Some(id) => msg.chat.id.0 == id,
        None => true, // If not set, allow everyone (dangerous but matches node implementation fallback)
    }
}
