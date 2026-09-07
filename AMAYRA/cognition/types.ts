/**
 * AMAYRA — cognition type system.
 *
 * These shared types were erased during esbuild bundling (types produce no JS)
 * so this file is reconstructed from their exact usage across the cognition
 * modules and server.ts. Names, shapes, and literal unions mirror the original
 * usage sites one-for-one.
 */

import type { CognitionConfig } from "./config";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export type PermissionName =
  | "microphone"
  | "screen_awareness"
  | "filesystem_read"
  | "filesystem_write"
  | "desktop_control"
  | "browser"
  | "network"
  | "automation"
  | "code_execution"
  | "system_control";

export type CognitiveState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "ACTING"
  | "LEARNING"
  | "PLANNING"
  | "VERIFYING"
  | "INTERRUPTED"
  | "OBSERVING"
  | "PAUSED";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface CognitiveEventInput {
  type: string;
  source: "system" | "desktop" | "tool" | "internal" | "memory" | "conversation" | "safety" | string;
  projectId?: string | null;
  correlationId?: string;
  importance?: number;
  confidence?: number;
  dedupeKey?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface CognitiveEvent extends Readonly<CognitiveEventInput> {
  readonly id: string;
  readonly timestamp: string;
  readonly importance: number;
  readonly confidence: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Situation model
// ---------------------------------------------------------------------------

export interface SituationEventSummary {
  id: string;
  type: string;
  timestamp: string;
  importance: number;
  source: string;
}

export interface SituationSnapshot {
  state: CognitiveState;
  currentActivity: string | null;
  activeApp: string | null;
  activeWindow: string | null;
  currentProject: string | null;
  conversationTopic: string | null;
  currentGoalId: string | null;
  currentTaskId: string | null;
  userActivity: "active" | "idle" | "away";
  userSpeaking: boolean;
  amayraSpeaking: boolean;
  amayraWasInterrupted: boolean;
  silenceStartedAt: string | null;
  silenceSeconds: number;
  openApplications: string[];
  relevantFiles: string[];
  recentImportantEvents: SituationEventSummary[];
  recentFailures: SituationEventSummary[];
  recentSuccesses: SituationEventSummary[];
  pendingRisk: {
    eventId: string;
    description: string;
    level: RiskLevel;
    confirmationId?: string;
  } | null;
  autonomyPaused: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

export interface AttentionFactors {
  relevance: number;
  novelty: number;
  urgency: number;
  risk: number;
  userImpact: number;
  taskRelevance: number;
  confidence: number;
  repetitionPenalty: number;
  interruptionCost: number;
}

export interface AttentionAssessment {
  eventId: string;
  score: number;
  factors: AttentionFactors;
  semanticKey: string;
  explanation: string[];
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

export type InitiativeAction =
  | "IGNORE"
  | "OBSERVE"
  | "REMEMBER"
  | "WAIT"
  | "SPEAK"
  | "ASK"
  | "WARN";

export interface InitiativeDecisionReason {
  reason: string;
  urgency: number;
  novelty: number;
  confidence: number;
  interruptionAllowed: boolean;
  suggestedTone: string;
}

export interface InitiativeDecision {
  eventId: string;
  action: InitiativeAction;
  attentionScore: number;
  reason: InitiativeDecisionReason;
  shouldGenerateSpeech: boolean;
  createdAt: string;
}

export interface SocialOpportunity {
  score: number;
  reason: string;
  userAvailability: number;
  topicRelevance: number;
  novelty: number;
  interruptionCost: number;
  continuationValue: number;
}

export type SocialSilenceType =
  | "CONVERSATIONAL_PAUSE"
  | "AWKWARD_UNRESOLVED_SILENCE"
  | "THINKING_SILENCE"
  | "WORKING_SILENCE"
  | "USER_AWAY"
  | "NATURAL_END";

// ---------------------------------------------------------------------------
// Conversation threads
// ---------------------------------------------------------------------------

export type ConversationThreadStatus = "ACTIVE" | "OPEN_ENDED" | "INTERRUPTED" | "WAITING_FOR_USER";

export interface ConversationThread {
  id: string;
  topic: string;
  status: ConversationThreadStatus;
  importance: number;
  unresolvedPoints: string[];
  openQuestions: string[];
  lastUserStatement: string | null;
  lastAmayraStatement: string | null;
  interruptedThoughts: string[];
  possibleFollowups: string[];
  lastUserAt: number | null;
  lastAmayraAt: number | null;
  activeUntil: number;
  autonomousTurnsSinceUser: number;
}

// ---------------------------------------------------------------------------
// Thoughts (endogenous cognition)
// ---------------------------------------------------------------------------

export type ThoughtOrigin = "memory" | "curiosity" | "unfinished_thread" | "goal" | "reflection" | "social";

export type SuggestedAction =
  | "REMEMBER"
  | "WAIT"
  | "SPEAK"
  | "ASK"
  | "SUGGEST"
  | "ACT"
  | "REVISIT_LATER";

export interface ThoughtCandidate {
  id: string;
  createdAt: number;
  origin: ThoughtOrigin;
  content: string;
  relevance: number;
  novelty: number;
  urgency: number;
  socialValue: number;
  confidence: number;
  suggestedAction: SuggestedAction;
  relatedTopic?: string;
  relatedMemoryIds?: string[];
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Structured memory
// ---------------------------------------------------------------------------

export type MemoryKind = "semantic" | "episodic" | "preference" | "project" | "correction" | "skill" | "working";

export interface StructuredMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  projectId: string | null;
  entities: string[];
  tags: string[];
  confidence: number;
  confirmations: number;
  importance: number;
  source: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  expiresAt: string | null;
  supersedesId?: string;
  active: boolean;
}

export interface MemoryQuery {
  text?: string;
  entities?: string[];
  kinds?: MemoryKind[];
  projectId?: string | null;
  minConfidence?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Goals & tasks
// ---------------------------------------------------------------------------

export type GoalStatus = "pending" | "active" | "blocked" | "completed" | "failed" | "cancelled";
export type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface GoalTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dependsOn: string[];
  attempts: number;
  maxRetries: number;
  timeoutMs: number;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  objective: string;
  constraints: string[];
  successCriteria: string[];
  priority: number;
  status: GoalStatus;
  projectId: string | null;
  tasks: GoalTask[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface LearnedSkillStep {
  id?: string;
  action: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

export interface LearnedSkill {
  id: string;
  name: string;
  description: string;
  preconditions: string[];
  steps: LearnedSkillStep[];
  expectedOutcome: string;
  projectId: string | null;
  confidence: number;
  uses: number;
  successes: number;
  failures: number;
  successRate: number;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  name: string;
  purpose: string;
  permission: PermissionName;
  riskLevel: RiskLevel;
  timeoutMs: number;
  maxRetries: number;
}

export interface ToolExecutionContext {
  projectRoot?: string;
  correlationId?: string;
  confirmed?: boolean;
}

export type ToolExecutionStatus =
  | "succeeded"
  | "failed"
  | "denied"
  | "confirmation_required"
  | "timed_out"
  | "cancelled";

export interface ToolExecutionResult {
  success: boolean;
  status: ToolExecutionStatus;
  tool: string;
  result: unknown;
  error: string | null;
  riskLevel: RiskLevel;
  durationMs: number;
  attempts: number;
  confirmationId?: string;
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

export interface CriticVerdict {
  passed: boolean;
  retryRecommended: boolean;
  reason: string;
  missing: string[];
}

// ---------------------------------------------------------------------------
// Model router
// ---------------------------------------------------------------------------

export type ModelCapability = "fast" | "reasoning" | "coding" | "vision" | "research" | "embedding" | "speech";

export interface ModelCallResult {
  text: string;
  model: string;
  capability: ModelCapability;
  durationMs: number;
  cached: boolean;
  attempts: number;
}

// ---------------------------------------------------------------------------
// Cognition counters (autonomous mind telemetry)
// ---------------------------------------------------------------------------

export interface CognitionCounters {
  cognitiveTicks: number;
  deepCognitiveMoments: number;
  internalThoughtsGenerated: number;
  internalThoughtsDropped: number;
  autonomousSpeechAttempts: number;
  autonomousSpeechCompleted: number;
  autonomousSpeechInterrupted: number;
  repetitionSuppressed: number;
}

// Re-export config type so barrel consumers can import it from this module too.
export type { CognitionConfig };
