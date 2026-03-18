# Rollback Runbook

## When to Rollback

- Error rate > 10%
- FSM transitions failing
- LINE bot not responding
- Customer complaints

## Rollback Steps

### 1. Vercel Rollback

```bash
# Rollback to previous deployment
vercel rollback

# Or use Vercel dashboard
# Go to Deployments → Select previous working deployment → Promote to Production
```

### 2. Verify Rollback

```bash
# Check current deployment
vercel list

# Test webhook
 curl https://your-domain.vercel.app/api/webhook -X POST -d '{}'
```

### 3. Monitor

Watch logs for 30 minutes after rollback:

```bash
vercel logs
```

## Database Considerations

**Note:** Database migrations are forward-only. If schema changed:

1. Check if new code is compatible with old schema
2. If not, may need data migration script
3. Contact team lead if unsure

## Post-Rollback

1. Document what went wrong
2. Fix issues in worktree
3. Re-deploy after testing
