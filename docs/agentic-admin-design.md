# Onecha LINE Bot — Agentic Superadmin Web Panel

## Design Document
**Date:** 2025-05-05
**Status:** Draft — awaiting implementation

---

## 1. Vision

The web panel is not an admin dashboard. It is an **agentic business command center** where the owner (superadmin) can:

- **Talk to the business** in natural language
- **See live, generated dashboards** based on queries (not static charts)
- **Control every aspect** of the LINE bot without touching code
- **Operate at the speed of thought** — type or click, never wait

The web becomes the core operations system. LINE becomes one of many channels.

---

## 2. Goals

### Must-Have (Week 1-2)
1. **Order Management Dashboard**
   - Real-time order table (filter, sort, search)
   - One-click accept / ship / schedule / cancel
   - Bulk actions (accept 10 orders at once)
   - Order detail view with customer info, status history, timeline
   - Stuck orders alert (processing >3 days)

2. **Bot Configuration Panel**
   - FSM state editor (states, transitions, rules)
   - Prompt editor (lead capture, qualification, negotiation messages)
   - Admin/staff management (add/remove, permissions)
   - Group management (admin groups, customer groups)

3. **Analytics Overview**
   - Today's orders, revenue, pending
   - Weekly stats (shipped, avg time, stuck)
   - Customer funnel (lead → quote → order → paid → shipped)

### Should-Have (Week 3-4)
4. **Natural Language Query Interface**
   - Chat input: "show me orders from Bangkok over 5000 baht this month"
   - Auto-generates filtered table + summary stats
   - "What's my conversion rate from quote to order?"
   - "Which customers ordered twice this month?"

5. **Dynamic Dashboard Generation**
   - LLM interprets query → generates chart type (bar, line, pie, table)
   - Renders with real data
   - Saveable "views" (bookmark a query + visualization)

### Could-Have (Month 2+)
6. **Agentic Actions**
   - "Send reminder to all customers with orders stuck 3+ days"
   - "Generate a quote for this customer"
   - "Summarize this week's sales in Thai for my LINE admin group"

7. **Multi-Channel Preview**
   - See how the bot responds to a test message
   - Simulate customer conversations
   - A/B test prompt variations

---

## 3. Architecture

### Option: Extend Existing Bot (Recommended)

Since the LINE bot is already on Vercel with MongoDB, the fastest path is adding web routes to the same deployment.

```
Current:                    Future:
┌──────────────┐          ┌──────────────┐
│  LINE API    │          │  LINE API    │
└──────┬───────┘          └──────┬───────┘
       │                         │
       ▼                         ▼
┌──────────────┐          ┌──────────────┐
│  /api/webhook│          │  /api/webhook│
│  (existing)  │          │  (existing)  │
└──────┬───────┘          ├──────────────┤
       │                  │  /api/admin/*│
       ▼                  │  /admin/*    │
┌──────────────┐          │  (new web)   │
│   MongoDB    │          └──────┬───────┘
│   (shared)   │                 │
└──────────────┘                 ▼
                          ┌──────────────┐
                          │   MongoDB    │
                          │   (shared)   │
                          └──────────────┘
```

### Why Not a Separate Next.js App?

- Reuse MongoDB connection, schemas, types
- Reuse auth patterns (can evolve from LINE admin sessions)
- Reuse fulfillment service logic
- Single deploy, single environment variables
- Can always split later if needed

### Tech Stack

- **Framework:** Add Express server (already in deps) or use Vercel's file-based routing for HTML pages
- **Frontend:** HTMX + Tailwind (lightweight, server-rendered) OR Next.js if we want React
- **Auth:** Session-based (reuse admin session logic, or add web-specific JWT)
- **Charts:** Chart.js or Recharts (for dynamic dashboards)
- **LLM:** OpenAI (already in deps) for agentic queries
- **Real-time:** Server-Sent Events or polling (WebSocket not available on Vercel)

---

## 4. Data Model Additions

### Web Admin Session
```typescript
interface WebAdminSession {
  sessionId: string;
  userId: string;          // Could be LINE userId or email
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
}
```

### Dashboard View (Saved Queries)
```typescript
interface DashboardView {
  _id: ObjectId;
  name: string;
  query: string;           // Natural language query
  filters: object;         // Structured filters
  chartType: "table" | "bar" | "line" | "pie";
  createdAt: Date;
  updatedAt: Date;
}
```

### Bot Configuration
```typescript
interface BotConfig {
  _id: ObjectId;
  key: string;             // "fsm_rules", "prompts", "pricing"
  value: object;
  updatedAt: Date;
  updatedBy: string;
}
```

---

## 5. API Design

### Order Management
```
GET    /api/admin/orders              → List orders (with filters)
POST   /api/admin/orders/:id/accept   → Accept order
POST   /api/admin/orders/:id/ship     → Ship order
POST   /api/admin/orders/:id/schedule → Schedule fulfillment
POST   /api/admin/orders/bulk-accept  → Bulk accept
GET    /api/admin/orders/stuck        → Stuck orders
```

### Bot Configuration
```
GET    /api/admin/config/fsm          → FSM states & transitions
PUT    /api/admin/config/fsm          → Update FSM
GET    /api/admin/config/prompts      → Prompt templates
PUT    /api/admin/config/prompts      → Update prompts
GET    /api/admin/staff               → List staff
POST   /api/admin/staff               → Add staff
DELETE /api/admin/staff/:id           → Remove staff
```

### Analytics
```
GET    /api/admin/analytics/overview  → Today's summary
GET    /api/admin/analytics/weekly    → Weekly stats
GET    /api/admin/analytics/funnel    → Conversion funnel
```

### Agentic Query
```
POST   /api/admin/query               → Natural language → dashboard
Body: { "query": "show me orders stuck 3+ days" }
Response: { "type": "table", "data": [...], "summary": "5 orders" }
```

---

## 6. Page Design

### /admin/login
- Simple password login (or LINE QR login)
- Reuse `LINE_ADMIN_PASSWORD` env var

### /admin/dashboard (Home)
- Today's orders count + revenue
- Pending orders alert
- Stuck orders alert (click to filter)
- Quick actions: Accept All, Send Reminders

### /admin/orders
- Full data table (sortable, filterable)
- Columns: ID, Customer, Status, Value, Created, Actions
- Bulk select + actions
- Detail slide-out panel

### /admin/bot-config
- FSM visual editor (states as nodes, transitions as edges)
- Prompt editor with preview
- Admin/staff table with role management

### /admin/analytics
- Saved views list
- Natural language input box
- Dynamic chart rendering area
- "Save this view" button

### /admin/query (Agentic Interface)
- Chat-style interface
- User types query
- System responds with rendered dashboard + suggested actions
- History of queries

---

## 7. Authentication & Authorization

### Phase 1: Simple Password
- Reuse `LINE_ADMIN_PASSWORD` env var
- Session stored in MongoDB (`web_admin_sessions`)
- 24-hour expiration

### Phase 2: LINE Login (Optional)
- LINE OAuth login
- Maps to existing `admin_sessions`
- QR code login from mobile

### Authorization
- Only superadmin can access web panel
- Read-only staff view (future)

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bot + web in same codebase gets messy | Medium | Clean separation: `api/admin/*` routes, shared `lib/` only |
| Vercel serverless cold starts for web UI | Low | Add caching, use Edge functions for static assets |
| LLM queries are slow/expensive | Medium | Cache common queries, allow pre-defined views |
| Auth complexity | Low | Start with simple password, evolve to OAuth |
| Staff resistance to web vs LINE | High | Web must be strictly better, not just different |

---

## 9. Implementation Plan

### Week 1: Foundation
- [ ] Add Express server with HTML rendering
- [ ] Build `/admin/login` page
- [ ] Build `/admin/dashboard` with order counts
- [ ] Add `/api/admin/orders` endpoints

### Week 2: Order Management
- [ ] Full orders table with filters
- [ ] Accept/Ship/Schedule actions
- [ ] Bulk operations
- [ ] Order detail view

### Week 3: Bot Config
- [ ] FSM state editor
- [ ] Prompt editor
- [ ] Staff management UI

### Week 4: Agentic Layer
- [ ] Natural language query endpoint
- [ ] Dynamic chart rendering
- [ ] Save views feature

---

## 10. Success Metrics

- Admin opens web panel at least once daily
- 50%+ of order actions happen via web (not LINE) within 2 weeks
- FSM rules changed via web (not code deploy) within 1 week
- Natural language query used at least 3x per week

---

## Next Steps

1. **Confirm approach:** Extend existing bot vs separate app?
2. **Confirm tech stack:** HTMX + Express vs Next.js?
3. **Confirm auth:** Simple password vs LINE OAuth?
4. **Begin implementation** — start with login + dashboard

---

*Design doc produced via YC Office Hours — Builder Mode with Startup rigor.*
