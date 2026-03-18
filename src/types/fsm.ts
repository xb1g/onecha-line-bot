import type { LeadState } from "./lead";

export interface TransitionContext {
  leadId: string;
  message: string;
  extractedData?: Record<string, unknown>;
  lineUserId: string;
}

export interface StateTransition {
  from: LeadState;
  to: LeadState;
  condition?: (context: TransitionContext) => Promise<boolean>;
}

export interface FSMState {
  name: LeadState;
  description: string;
  entryActions: Array<(context: TransitionContext) => Promise<void>>;
  exitActions: Array<(context: TransitionContext) => Promise<void>>;
  allowedTransitions: LeadState[];
}

export interface LLMExtractionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
}
