#!/usr/bin/env python3
"""
Typeless Menu Bar App
macOS menu bar interface for Typeless voice memo server
"""

import rumps
import requests
import json
import os
from pathlib import Path

# Configuration
SERVER_URL = "http://localhost:52345"
CONFIG_FILE = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/99_系统/Skills/.env"

class TypelessMenuBar(rumps.App):
    def __init__(self):
        super().__init__("🎙️", quit_button=None)
        
        # State
        self.status = "ready"  # ready / recording / processing / done
        self.config = self.load_config()
        
        # Build menu
        self.build_menu()
        
        # Start periodic updates
        self.timer = rumps.Timer(self.update_status, 1)
        self.timer.start()
    
    def load_config(self):
        """Load configuration from .env file"""
        config = {
            'mode': 'local',
            'asr_engine': 'auto',
            'llm_model': 'qwen2.5:3b'
        }
        
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE) as f:
                for line in f:
                    line = line.strip()
                    if '=' in line and not line.startswith('#'):
                        key, value = line.split('=', 1)
                        if key == 'MODE':
                            config['mode'] = value
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
        mode_display = "Cloud (Gemini)" if self.config['mode'] == 'cloud' else f"Local ({self.config['llm_model']})"
        self.menu.add(rumps.MenuItem(f"📡 Mode: {mode_display}", callback=None))
        
        asr_display = self.config['asr_engine'].upper() if self.config['asr_engine'] != 'auto' else "Auto (FunASR→Whisper)"
        self.menu.add(rumps.MenuItem(f"🎤 ASR: {asr_display}", callback=None))
        
        self.menu.add(rumps.separator)
        
        # Actions
        if self.config['mode'] == 'local':
            self.menu.add(rumps.MenuItem("⚡ Switch to Cloud Mode", callback=self.switch_to_cloud))
        else:
            self.menu.add(rumps.MenuItem("💻 Switch to Local Mode", callback=self.switch_to_local))
        
        self.menu.add(rumps.separator)
        
        # Preferences submenu
        prefs = rumps.MenuItem("🔧 Preferences")
        prefs.add(rumps.MenuItem("📂 Open Output Folder", callback=self.open_output))
        prefs.add(rumps.MenuItem("📄 Open Logs", callback=self.open_logs))
        prefs.add(rumps.MenuItem("⚙️ Edit Config", callback=self.edit_config))
        self.menu.add(prefs)
        
        self.menu.add(rumps.separator)
        
        # Statistics (placeholder for future)
        # stats = rumps.MenuItem("📊 Statistics")
        # self.menu.add(stats)
        # self.menu.add(rumps.separator)
        
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
    
    @rumps.clicked("Switch to Cloud Mode")
    def switch_to_cloud(self, _):
        """Switch to cloud mode"""
        self.update_config('MODE', 'cloud')
        self.config['mode'] = 'cloud'
        self.build_menu()
        rumps.notification("Typeless", "Mode Switched", "Now using Cloud (Gemini)")
    
    @rumps.clicked("Switch to Local Mode")
    def switch_to_local(self, _):
        """Switch to local mode"""
        self.update_config('MODE', 'local')
        self.config['mode'] = 'local'
        self.build_menu()
        rumps.notification("Typeless", "Mode Switched", "Now using Local Mode")
    
    def update_config(self, key, value):
        """Update configuration in .env file"""
        if not CONFIG_FILE.exists():
            return
        
        with open(CONFIG_FILE, 'r') as f:
            lines = f.readlines()
        
        updated = False
        for i, line in enumerate(lines):
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                updated = True
                break
        
        if not updated:
            lines.append(f"{key}={value}\n")
        
        with open(CONFIG_FILE, 'w') as f:
            f.writelines(lines)
    
    @rumps.clicked("Open Output Folder")
    def open_output(self, _):
        """Open output folder in Finder"""
        output_dir = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/00_收集"
        os.system(f'open "{output_dir}"')
    
    @rumps.clicked("Open Logs")
    def open_logs(self, _):
        """Open logs folder"""
        logs_dir = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/99_系统/Skills/logs"
        os.system(f'open "{logs_dir}"')
    
    @rumps.clicked("Edit Config")
    def edit_config(self, _):
        """Open config file in default editor"""
        os.system(f'open "{CONFIG_FILE}"')

if __name__ == "__main__":
    TypelessMenuBar().run()
