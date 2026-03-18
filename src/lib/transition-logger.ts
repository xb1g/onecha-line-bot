/**
 * FSM Transition logging service.
 * Logs all state transitions to MongoDB for debugging and analytics.
 */

import { ObjectId, type Document } from "mongodb";
import { getCollection } from "./mongodb";
import type { LeadState } from "../types/lead";
import { logger } from "./logger";

export const FSM_TRANSITIONS_COLLECTION = "fsm_transitions";

export interface FSMTransitionDocument extends Document {
  _id?: ObjectId;
  leadId: ObjectId;
  lineUserId: string;
  fromState: LeadState;
  toState: LeadState;
  trigger: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface LogTransitionInput {
  leadId: ObjectId | string;
  lineUserId: string;
  fromState: LeadState;
  toState: LeadState;
  trigger: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a state transition to MongoDB.
 * This is called by transitionLead() after successful transition.
 */
export async function logTransition(input: LogTransitionInput): Promise<void> {
  try {
    const collection = await getCollection<FSMTransitionDocument>(FSM_TRANSITIONS_COLLECTION);

    const doc: FSMTransitionDocument = {
      leadId: typeof input.leadId === "string" ? new ObjectId(input.leadId) : input.leadId,
      lineUserId: input.lineUserId,
      fromState: input.fromState,
      toState: input.toState,
      trigger: input.trigger,
      metadata: input.metadata,
      createdAt: new Date(),
    };

    await collection.insertOne(doc);

    logger.debug("FSM transition logged to MongoDB", {
      leadId: input.leadId.toString(),
      userId: input.lineUserId,
      fromState: input.fromState,
      toState: input.toState,
    });
  } catch (error) {
    // Log error but don't fail the transition - this is observability, not business logic
    logger.error("Failed to log FSM transition", {
      leadId: input.leadId.toString(),
      userId: input.lineUserId,
      fromState: input.fromState,
      toState: input.toState,
    }, error instanceof Error ? error : undefined);
  }
}

/**
 * Get transition history for a lead
 */
export async function getTransitionHistory(
  leadId: ObjectId | string,
  limit = 50
): Promise<FSMTransitionDocument[]> {
  const collection = await getCollection<FSMTransitionDocument>(FSM_TRANSITIONS_COLLECTION);
  const objectId = typeof leadId === "string" ? new ObjectId(leadId) : leadId;

  return await collection
    .find({ leadId: objectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Get transition statistics for analytics
 */
export async function getTransitionStats(
  fromState?: LeadState,
  hours = 24
): Promise<Array<{ fromState: LeadState; toState: LeadState; count: number }>> {
  const collection = await getCollection<FSMTransitionDocument>(FSM_TRANSITIONS_COLLECTION);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const matchStage: Record<string, unknown> = {
    createdAt: { $gte: cutoff },
  };

  if (fromState) {
    matchStage.fromState = fromState;
  }

  const results = await collection
    .aggregate<{ fromState: LeadState; toState: LeadState; count: number }>([
      { $match: matchStage },
      {
        $group: {
          _id: { fromState: "$fromState", toState: "$toState" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          fromState: "$_id.fromState",
          toState: "$_id.toState",
          count: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return results;
}
