---
description: Run InkBrain Sentinel in Notes mode
---

# Run InkBrain Sentinel (Mac Notes Mode)

Quick commands to start the sentinel service for Mac Notes app.

## Foreground (Development)

// turbo-all
```bash
source venv/bin/activate
python notes_sentinel.py
```

Stop with `Ctrl+C`

## Background (Production)

```bash
source venv/bin/activate
nohup python notes_sentinel.py > notes_sentinel.log 2>&1 &
echo $! > notes_sentinel.pid
```

## Check Status

```bash
ps aux | grep notes_sentinel.py
```

## Stop Background Service

```bash
kill $(cat notes_sentinel.pid)
rm notes_sentinel.pid
```

## View Logs

```bash
tail -f notes_sentinel.log
```

## First Time Setup

**Grant Permissions:**
Mac Notes requires accessibility permissions for AppleScript automation.

1. System Preferences → Security & Privacy → Privacy
2. Select "Automation" in the left sidebar
3. Find "Terminal" or your IDE and enable "Notes"

**Test Notes Access:**
```bash
osascript -e 'tell application "Notes" to count notes'
```

If this returns a number, permissions are correctly configured.
