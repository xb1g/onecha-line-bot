# Deployment to Staging

## Prerequisites

- Vercel CLI installed: `npm i -g vercel`
- Environment variables configured in `.env.local`

## Steps

### 1. Deploy to Staging

```bash
# From the worktree directory
cd /Users/bunyasit/dev/onecha-line-bot/.worktrees/fsm-implementation

# Deploy to staging
vercel --staging
```

### 2. Environment Variables

Ensure these are set in Vercel dashboard (staging environment):

```
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
MONGODB_URI=
OPENAI_API_KEY=
CRON_SECRET=
```

### 3. Run Database Migrations

```bash
bun run setup-fsm-indexes
```

### 4. Smoke Test Checklist

- [ ] `/api/webhook` returns 200 for health check
- [ ] Send test message to LINE bot - should respond
- [ ] Test FSM flow: LEAD_CAPTURE → QUALIFY_BULK_INTENT → PRODUCT_DISCOVERY
- [ ] Test auto-pilot: "speak to human" → ESCALATION
- [ ] Test quote generation with all 4 grades
- [ ] Test negotiation: ≤10% auto-approve, >20% escalate
- [ ] Test negative discount rejection
- [ ] Verify metrics endpoint `/api/metrics`

### 5. Monitor Logs

```bash
vercel logs --staging
```

## Rollback

If issues found:

```bash
vercel --staging rollback
```
