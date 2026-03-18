# Multi-Group Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support multiple LINE groups with role-aware behavior, where configured groups are admin groups and all other groups are customer groups.

**Architecture:** Replace the single `admin_group_id` state entry with a `line_groups` registry keyed by `groupId`. Classify group roles from `LINE_ADMIN_GROUP_IDS`, persist discovered groups on join/message, fan out operational broadcasts to all admin groups, and branch webhook behavior by group role.

**Tech Stack:** TypeScript, Bun, MongoDB, LINE Messaging API

---

### Task 1: Add persistent group role model

**Files:**
- Modify: `src/types/mongodb.ts`
- Modify: `src/services/line-client.ts`

**Steps:**
1. Add `LineGroupDocument` and `LineGroupRole` types.
2. Add helpers to normalize `LINE_ADMIN_GROUP_IDS` from env.
3. Add methods to upsert a group, classify role, fetch one group role, and list all admin group IDs.
4. Keep compatibility fallback to legacy `bot_state.admin_group_id`.

### Task 2: Route joins and messages by group role

**Files:**
- Modify: `src/handlers/webhook.ts`
- Modify: `src/fsm/router.ts` if routing context needs extension

**Steps:**
1. Persist group records on join and on first message from a group.
2. On group join, reply with an admin or customer welcome based on role.
3. Only allow fulfillment/admin commands in admin groups or direct admins.
4. Route customer-group messages into the sales/support FSM path.

### Task 3: Fan out operational sends to all admin groups

**Files:**
- Modify: `src/services/line-client.ts`

**Steps:**
1. Replace single-group send logic with multi-group iteration.
2. Return partial failure details when one or more admin groups fail.
3. Preserve daily/weekly bot-state markers only when at least one send succeeds.

### Task 4: Verify and inspect

**Files:**
- Modify: `scripts/list-group-ids.ts`

**Steps:**
1. Update the inspection script to read from the new `line_groups` collection and show roles.
2. Run `bun run scripts/list-group-ids.ts`.
3. Run `npm run typecheck`.
