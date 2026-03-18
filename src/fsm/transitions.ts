import type { LeadState } from "../types/lead";
import type { TransitionContext } from "../types/fsm";
import { VALID_TRANSITIONS } from "./states";

export class TransitionError extends Error {
  constructor(from: LeadState, to: LeadState, reason: string) {
    super(`Cannot transition from ${from} to ${to}: ${reason}`);
    this.name = "TransitionError";
  }
}

export async function canTransition(
  from: LeadState,
  to: LeadState,
  context: TransitionContext
): Promise<boolean> {
  const allowedTransitions = VALID_TRANSITIONS[from];

  if (!allowedTransitions.includes(to)) {
    return false;
  }

  if (to === "FAILED") {
    return isSpamMessage(context.message) || from !== "LEAD_CAPTURE";
  }

  if (to === "ESCALATION") {
    return Boolean(context.extractedData?.escalationReason);
  }

  return true;
}

export async function assertTransitionAllowed(
  from: LeadState,
  to: LeadState,
  context: TransitionContext
): Promise<void> {
  const allowed = await canTransition(from, to, context);
  if (!allowed) {
    throw new TransitionError(from, to, "Transition not allowed");
  }
}

function isSpamMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const spamKeywords = ["crypto", "investment", "lottery", "prize", "winner"];
  return spamKeywords.some((keyword) => normalized.includes(keyword));
}

