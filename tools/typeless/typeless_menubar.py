#!/usr/bin/env python3
"""
Typeless Menu Bar App
macOS menu bar interface for Typeless voice memo server (Local Only)
"""

import rumps
import requests
import json
import os
from pathlib import Path

# Configuration
SERVER_URL = "http://localhost:52345"

# Dynamically find paths based on the script location
SCRIPT_DIR = Path(__file__).parent.resolve()
CONFIG_FILE = SCRIPT_DIR / ".env"
LOGS_DIR = SCRIPT_DIR / "logs"

class TypelessMenuBar(rumps.App):
    def __init__(self):
        super().__init__("🎙️", quit_button=None)
        
        # State
        self.status = "ready"  # ready / recording / processing / done
        self.config = self.load_config()
        
        # Determine Output Directory
        self.output_dir = Path.home() / "mox/neo/inbox"
        if 'OUTPUT_DIR' in self.config:
            custom_output = Path(self.config['OUTPUT_DIR'])
            if custom_output.is_absolute():
                self.output_dir = custom_output
            else:
                self.output_dir = SCRIPT_DIR.parent.parent / custom_output
        
        # Build menu
        self.build_menu()
        
        # Start periodic updates
        self.timer = rumps.Timer(self.update_status, 1)
        self.timer.start()
    
    def load_config(self):
        """Load configuration from .env file"""
        config = {
            'asr_engine': 'auto',
            'llm_model': 'qwen2.5:3b'
        }
        
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE) as f:
                for line in f:
                    line = line.strip()
                    if '=' in line and not line.startswith('#'):
                        key, value = line.split('=', 1)
                        if key == 'OUTPUT_DIR':
                            config['OUTPUT_DIR'] = value
                        elif key == 'ASR_ENGINE':
                            config['asr_engine'] = value
                        elif key == 'LOCAL_LLM_MODEL':
                            config['llm_model'] = value
        
        return config
    
    def build_menu(self):
        """Build the menu structure"""
        self.menu.clear()
        
        # Status indicator
        status_emoji = {
            'ready': '🟢',
            'recording': '🔴',
            'processing': '⚙️',
            'done': '✅'
        }
        status_text = {
            'ready': 'Ready',
            'recording': 'Recording...',
            'processing': 'Processing...',
            'done': 'Done'
        }
        
        emoji = status_emoji.get(self.status, '🟢')
        text = status_text.get(self.status, 'Ready')
        self.menu.add(rumps.MenuItem(f"{emoji} Status: {text}", callback=None))
        
        self.menu.add(rumps.separator)
        
        # Configuration display
        self.menu.add(rumps.MenuItem(f"💻 Mode: Local ({self.config['llm_model']})", callback=None))
        
        asr_display = self.config['asr_engine'].upper() if self.config['asr_engine'] != 'auto' else "Auto (FunASR→Whisper)"
        self.menu.add(rumps.MenuItem(f"🎤 ASR: {asr_display}", callback=None))
        
        self.menu.add(rumps.separator)
        
        # Preferences submenu
        prefs = rumps.MenuItem("🔧 Preferences")
        prefs.add(rumps.MenuItem("📂 Open Output Folder", callback=self.open_output))
        prefs.add(rumps.MenuItem("📄 Open Logs", callback=self.open_logs))
        prefs.add(rumps.MenuItem("⚙️ Edit Config", callback=self.edit_config))
        self.menu.add(prefs)
        
        self.menu.add(rumps.separator)
        
        # Quit
        self.menu.add(rumps.MenuItem("Quit Typeless", callback=rumps.quit_application))
    
    def update_status(self, _):
        """Periodically check server status and update menu"""
        try:
            # Try to get status from server
            response = requests.get(f"{SERVER_URL}/api/status", timeout=0.5)
            if response.status_code == 200:
                data = response.json()
                new_status = data.get('state', 'ready')
                
                if new_status != self.status:
                    self.status = new_status
                    
                    # Update menu bar icon based on status
                    icon_map = {
                        'ready': '🎙️',
                        'recording': '🔴',
                        'processing': '⚙️',
                        'done': '✅'
                    }
                    self.title = icon_map.get(new_status, '🎙️')
                    
                    # Rebuild menu to show new status
                    self.build_menu()
        except:
            # Server not responding, keep current status
            pass
    
    @rumps.clicked("Open Output Folder")
    def open_output(self, _):
        """Open output folder in Finder"""
        os.system(f'open "{self.output_dir}"')
    
    @rumps.clicked("Open Logs")
    def open_logs(self, _):
        """Open logs folder"""
        os.system(f'open "{LOGS_DIR}"')
    
    @rumps.clicked("Edit Config")
    def edit_config(self, _):
        """Open config file in default editor"""
        os.system(f'open "{CONFIG_FILE}"')

if __name__ == "__main__":
    TypelessMenuBar().run()
