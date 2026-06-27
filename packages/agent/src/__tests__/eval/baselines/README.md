# Baseline snapshots

Baseline snapshots are stored here as `baseline.json`.

A baseline captures the eval scores from a known-good run so that future runs
can be compared against it to detect regressions or measure improvements.

## Workflow

```bash
# 1. Run evals (outputs src/__tests__/eval/reports/latest.json)
npm run eval:run

# 2. Compare against saved baseline
npm run eval:compare

# 3. After verifying that changes are improvements, promote latest to baseline
npm run eval:update-baseline
```

The `baseline.json` file is intentionally NOT committed to the repository by
default because it depends on the model / API keys available in your
environment.  Commit it when you want to track score changes in CI.
