# Deployment to Production

## Prerequisites

- Staging deployment verified
- All smoke tests passing
- Database migrations completed

## Steps

### 1. Deploy to Production

```bash
# From the worktree directory
cd /Users/bunyasit/dev/onecha-line-bot/.worktrees/fsm-implementation

# Deploy to production
vercel --prod
```

### 2. Verify Deployment

Check Vercel dashboard for successful deployment.

### 3. Post-Deploy Verification

Run these checks within 5 minutes of deploy:

- [ ] Webhook endpoint responds with 200
- [ ] LINE bot responds to test message
- [ ] FSM state transitions working
- [ ] Quote generation working
- [ ] No errors in Vercel logs

### 4. Monitor for 1 Hour

Watch for:
- Error rates
- FSM transition success rate
- LLM fallback rate
- Response times

### 5. Announce

Notify team of successful deployment.

## Emergency Rollback

See `docs/runbooks/rollback.md`
