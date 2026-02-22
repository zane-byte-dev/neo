import os
import sys

def refine_journal_to_post(journal_path):
    print(f"🚀 Inkbrain Refinery v0.1: Processing {journal_path}...")
    
    # Load configuration from scale.json
    import json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "scale.json")
    
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    prompt = config["config"]["system_prompt"]
    
    # 构造命令，将日记内容通过 cat 传给 gemini-cli
    output_path = "03_文章/Drafts/RedBook_Post_2026-02-07.md"
    cmd = f"cat '{journal_path}' | gemini ask '{prompt}' > '{output_path}'"
    
    os.system(cmd)
    print(f"✅ Success! Draft saved to: {output_path}")

if __name__ == "__main__":
    refine_journal_to_post("01_日记/2026-02-07.md")
