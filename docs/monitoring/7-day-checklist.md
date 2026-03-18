# 7-Day Monitoring Checklist

## Daily Checks

### Morning (9:00 AM)

- [ ] Check `/api/metrics` for:
  - fsm_transitions_total
  - llm_fallback_total
  - errors_total
  - quote_generated_total

- [ ] Check Vercel logs for errors:
  ```bash
  vercel logs --since=24h
  ```

- [ ] Check MongoDB (if access available):
  ```javascript
  // Check recent transitions
  db.fsm_transitions.find().sort({createdAt: -1}).limit(10)
  
  // Check error rate
  db.fsm_transitions.countDocuments({createdAt: {$gte: new Date(Date.now() - 24*60*60*1000)}})
  ```

### Evening (6:00 PM)

- [ ] Review day's FSM transitions
- [ ] Check for any stuck leads (>24h in non-terminal state)
- [ ] Verify no alerts triggered

## Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| errors_total | >5/hour | >20/hour |
| llm_fallback_rate | >30% | >50% |
| response_time | >3s | >10s |

## Weekly Report

Document and share:
- Total FSM transitions
- Most common error types
- LLM fallback rate
- Any incidents

## Response Procedures

### If errors spike:

1. Check Vercel logs immediately
2. If >10 errors/minute, consider rollback
3. Notify team lead

### If LLM fallback rate >50%:

1. Check OpenAI status
2. Verify rate limiting not too aggressive
3. Check API key validity
