use std::env;
use std::process;

pub fn handle_cli_args() -> bool {
    let args: Vec<String> = env::args().collect();
    if args.len() > 1 && args[1] == "run" {
        if args.len() < 3 {
            println!("Usage: neo-desktop run <skill> [args...]");
            process::exit(1);
        }
        
        let skill_name = args[2].clone();
        let extra_args = if args.len() > 3 {
            args[3..].to_vec()
        } else {
            Vec::new()
        };

        println!("[Neo] 💭 技能 [{}] 执行中...", skill_name);

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            let start_time = std::time::Instant::now();
            match crate::genai::run_skill(skill_name.clone(), extra_args).await {
                Ok(response) => {
                    let elapsed = start_time.elapsed().as_secs_f64();
                    println!("=========================================\n");
                    println!("{}", response);
                    println!("========================================= (⏱️  {:.2}s)", elapsed);
                },
                Err(e) => {
                    eprintln!("🔥 技能执行异常: {}", e);
                    process::exit(1);
                }
            }
        });
        
        return true;
    }

    if args.len() > 1 && args[1] == "tg-bot" {
        println!("[Neo] 🤖 Telegram Bot 模式启动中...");
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            crate::tg_bot::run_bot().await;
        });
        return true;
    }

    false
}
