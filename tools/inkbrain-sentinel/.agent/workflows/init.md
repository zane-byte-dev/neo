---
description: Initialize InkBrain Sentinel project
---

# Initialize InkBrain Sentinel

This workflow sets up the InkBrain Sentinel project from scratch.

## Steps

1. **Create virtual environment**
   ```bash
   python3 -m venv venv
   ```

// turbo
2. **Activate virtual environment**
   ```bash
   source venv/bin/activate
   ```

// turbo
3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

// turbo
4. **Verify installation**
   ```bash
   python -c "import watchdog; print('Dependencies installed successfully!')"
   ```

5. **Configure environment (optional)**
   - Copy `.env.example` to `.env`
   - Edit `.env` with your configuration

6. **Test the sentinel**
   ```bash
   python sentinel.py
   ```
   - Press Ctrl+C to stop
   - Check that it starts without errors

7. **Set up as background service (optional)**
   - Use `launchd` on macOS for automatic startup
   - Or use `nohup` for manual background execution
