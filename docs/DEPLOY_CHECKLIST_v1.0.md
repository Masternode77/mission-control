# Deployment Checklist v1.0 (Ops)

## Pre-deploy
- [ ] `git fetch --tags && git checkout main && git pull --ff-only`
- [ ] `npm ci`
- [ ] Verify env keys are present in runtime (not committed):
  - [ ] `TELEGRAM_BOT_TOKEN`
  - [ ] `TELEGRAM_MASTER_CHAT_ID`
  - [ ] OpenClaw/Gateway auth vars as required
- [ ] Confirm DB file path and backup policy
- [ ] Run read-only audit: `npx tsx scripts/safe-audit-zombies.ts`

## Build & Restart
- [ ] `npm run build`
- [ ] `pm2 restart all`
- [ ] `pm2 status`

## Health Checks
- [ ] API health: `curl -s http://127.0.0.1:3005/api/openclaw/status`
- [ ] Swarm summary: `curl -s http://127.0.0.1:3005/api/swarm/summary`
- [ ] DB sanity:
  - [ ] no stale in_execution >1h
  - [ ] no pending ghost approvals
- [ ] Cron dry-run alive (log growth): `logs/zombie-nuke-cron.log`

## Functional Smoke
- [ ] Create/ignite one intake task
- [ ] Verify task transitions: `intake -> orchestrating -> in_execution`
- [ ] Verify run record created in `swarm_runs`
- [ ] Verify event feed logs appear

## Rollback
- [ ] Identify rollback target commit/tag
- [ ] `git checkout <tag-or-commit>`
- [ ] `npm ci && npm run build`
- [ ] `pm2 restart all`
- [ ] Re-run health checks

## Security Gate (post-deploy)
- [ ] `git status` clean
- [ ] Secret scan on tracked files (pattern scan)
- [ ] Confirm `.gitignore` still blocks env/db/log artifacts
