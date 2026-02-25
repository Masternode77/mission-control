# DEPLOYMENT_RUNBOOK.md

## Table of Contents
1. Purpose
2. Prerequisites
3. Canary Deployment Procedure
4. Promote Criteria (Canary -> Main)
5. Rollback Procedure (Emergency)
6. Verification Checklist
7. Operational Notes

---

## 1) Purpose
This runbook defines a production-safe deployment flow for Mission Control with canary-first rollout, promotion criteria, and rapid rollback.

## 2) Prerequisites
- PM2 running with `ecosystem.config.js`
- `mission-control` (port 3005) healthy
- `mission-control-canary` (port 3006) available for staged rollout
- CI Gate green (`npm run ci:gate`)

## 3) Canary Deployment Procedure
### Command
```bash
npm run deploy:canary
```

### What it does
1. Runs `npm run build`
2. Starts canary process via PM2 (`mission-control-canary`)
3. Performs smoke checks against canary endpoints:
   - `GET /api/openclaw/status`
   - `GET /api/workspaces`

### Pass condition
- Both endpoints return HTTP 200 within timeout
- PM2 status for canary is `online`

## 4) Promote Criteria (Canary -> Main)
Promote only when all are true:
- CI Gate passed on same commit
- Canary smoke checks passed
- No critical errors in canary logs for at least 10-15 minutes
- Core path manually validated:
  - task create
  - orchestrate
  - state transition to `hitl_review/completed`

### Promote action
- Tag current commit as deploy candidate
- Reload main app:
```bash
pm2 reload ecosystem.config.js --only mission-control
```

## 5) Rollback Procedure (Emergency)
### Command (dry-run by default)
```bash
npm run rollback
```

### Apply rollback
```bash
npm run rollback -- --apply
```

### Rollback action sequence
1. Resolve last known good commit
2. `git checkout <last_good_commit>`
3. `npm run build`
4. `pm2 reload ecosystem.config.js`

## 6) Verification Checklist
- `pm2 list` shows all required processes online
- Main health: `curl -i http://127.0.0.1:3005/api/openclaw/status`
- Canary health: `curl -i http://127.0.0.1:3006/api/openclaw/status`
- CI gate history confirms no failed stage on deployed commit

## 7) Operational Notes
- Default rollback mode is dry-run for safety.
- Use `LAST_GOOD_COMMIT=<hash>` env var for deterministic rollback target.
- Keep canary and main isolated by port and PM2 process names.
