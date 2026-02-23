---
description: Run InkBrain Sentinel
---

# Run InkBrain Sentinel

Quick commands to start the sentinel service.

## Foreground (Development)

// turbo-all
```bash
source venv/bin/activate
python sentinel.py
```

Stop with `Ctrl+C`

## Background (Production)

```bash
source venv/bin/activate
nohup python sentinel.py > sentinel.log 2>&1 &
echo $! > sentinel.pid
```

## Check Status

```bash
ps aux | grep sentinel.py
```

## Stop Background Service

```bash
kill $(cat sentinel.pid)
rm sentinel.pid
```

## View Logs

```bash
tail -f sentinel.log
```
