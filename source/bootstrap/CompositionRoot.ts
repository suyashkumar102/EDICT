import type { RedisGateway } from '@infrastructure/redis/RedisGateway';
import { buildInMemoryRedisGateway } from '@infrastructure/redis/RedisGateway';
import type { EventStore } from '@infrastructure/eventstore/EventStore';
import { buildRedisEventStore } from '@infrastructure/eventstore/RedisEventStore';
import type { ActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import { buildActiveRulesProjection } from '@infrastructure/projections/ActiveRulesProjection';
import type { AuditTimelineProjection } from '@infrastructure/projections/AuditTimelineProjection';
import { buildAuditTimelineProjection } from '@infrastructure/projections/AuditTimelineProjection';
import type { BriefingFeed } from '@infrastructure/projections/BriefingFeedProjection';
import { buildBriefingFeed } from '@infrastructure/projections/BriefingFeedProjection';
import type { EffectivenessLeaderboard } from '@infrastructure/projections/EffectivenessLeaderboardProjection';
import { buildEffectivenessLeaderboard } from '@infrastructure/projections/EffectivenessLeaderboardProjection';
import type { ConflictMap } from '@infrastructure/projections/ConflictMapProjection';
import { buildConflictMap } from '@infrastructure/projections/ConflictMapProjection';
import type { TemplateGallery } from '@infrastructure/devvit/TemplateGallery';
import { buildTemplateGallery } from '@infrastructure/devvit/TemplateGallery';
import type { DevvitAdapter } from '@infrastructure/devvit/DevvitAdapter';
import { buildFakeDevvitAdapter } from '@infrastructure/devvit/DevvitAdapter';

import type { CompilerService, LLMPort } from '@compilation/llm/CompilerService';
import { buildCompilerService } from '@compilation/llm/CompilerService';
import { buildOpenAiLLMClient } from '@compilation/llm/OpenAiLLMClient';

import type { RollbackTokenService } from '@safety/RollbackTokenService';
import { buildRollbackTokenService } from '@safety/RollbackTokenService';
import type { ConsensusCoordinator } from '@safety/ConsensusCoordinator';
import { buildConsensusCoordinator } from '@safety/ConsensusCoordinator';
import type { CircuitBreakerService } from '@safety/CircuitBreakerService';
import { buildCircuitBreakerService } from '@safety/CircuitBreakerService';
import type { UndoLearningStrategy } from '@safety/UndoLearningStrategy';
import { buildUndoLearningStrategy } from '@safety/UndoLearningStrategy';
import type { AdaptiveShadowOrchestrator } from '@safety/AdaptiveShadowOrchestrator';
import { buildAdaptiveShadowOrchestrator } from '@safety/AdaptiveShadowOrchestrator';

import type { EffectivenessScorer } from '@analytics/EffectivenessScorer';
import { buildEffectivenessScorer } from '@analytics/EffectivenessScorer';
import type { ConflictDetector } from '@analytics/ConflictDetector';
import { buildConflictDetector } from '@analytics/ConflictDetector';
import type { WhatIfStudio } from '@analytics/WhatIfStudio';
import { buildWhatIfStudio } from '@analytics/WhatIfStudio';
import type { SuggestionEngine } from '@analytics/SuggestionEngine';
import { buildSuggestionEngine } from '@analytics/SuggestionEngine';
import type { BriefingComposer } from '@analytics/BriefingComposer';
import { buildBriefingComposer } from '@analytics/BriefingComposer';

import type { CommandBus } from '@orchestration/handlers/CommandBus';
import { buildCommandBus } from '@orchestration/handlers/CommandBus';
import type { QueryBus } from '@orchestration/handlers/QueryBus';
import { buildQueryBus } from '@orchestration/handlers/QueryBus';
import type { EventDispatcher } from '@orchestration/handlers/EventDispatcher';
import { buildEventDispatcher } from '@orchestration/handlers/EventDispatcher';

import type { Clock } from '@shared/utilities/Clock';
import { systemClock } from '@shared/utilities/Clock';
import { buildConfidence, type ConfidenceScore } from '@domain/values/ConfidenceScore';
import { brandPercent, type Percent } from '@shared/types/BrandedPrimitives';
import type { ConsensusMode } from '@domain/policies/ConsensusPolicy';

/**
 * Composition root. The ONE place in the entire codebase where services
 * are wired together. Every other file depends only on interfaces and
 * accepts its dependencies via parameters — that's why renaming an
 * adapter or swapping Redis for an in-memory gateway is a one-line
 * change here, not a 30-file refactor.
 *
 * The root reads the Devvit settings via the platform's settings API
 * (wired by Bootstrap.ts) and the rest of the system reads the typed
 * `settings` object on `root`.
 */

export interface ResolvedSettings {
  readonly sandboxMode: boolean;
  readonly adaptiveShadow: boolean;
  readonly shadowConfidenceThreshold: ConfidenceScore;
  readonly shadowMinObservations: number;
  readonly shadowMaxHours: number;
  readonly perRuleActionCeiling: number;
  readonly subwideActionCeiling: number;
  readonly rolloutPercent: Percent;
  readonly consensusRequired: ConsensusMode;
  readonly rollbackWindowDays: number;
  readonly compilerModel: string;
  readonly compilerVerbosity: 'strict' | 'balanced' | 'permissive';
}

export interface CompositionRootInputs {
  readonly redis?: RedisGateway;
  readonly devvitAdapter?: DevvitAdapter;
  readonly llmClient?: LLMPort;
  readonly clock?: Clock;
  readonly settings: ResolvedSettings;
  readonly openaiApiKey?: string;
}

export interface CompositionRoot {
  readonly redis: RedisGateway;
  readonly events: EventStore;
  readonly activeRules: ActiveRulesProjection;
  readonly auditTimeline: AuditTimelineProjection;
  readonly briefingFeed: BriefingFeed;
  readonly leaderboard: EffectivenessLeaderboard;
  readonly conflictMap: ConflictMap;
  readonly templateGallery: TemplateGallery;
  readonly devvitAdapter: DevvitAdapter;

  readonly compiler: CompilerService;
  readonly rollback: RollbackTokenService;
  readonly consensus: ConsensusCoordinator;
  readonly circuitBreaker: CircuitBreakerService;
  readonly undoLearning: UndoLearningStrategy;
  readonly adaptiveShadow: AdaptiveShadowOrchestrator;

  readonly effectivenessScorer: EffectivenessScorer;
  readonly conflictDetector: ConflictDetector;
  readonly whatIfStudio: WhatIfStudio;
  readonly suggestionEngine: SuggestionEngine;
  readonly briefingComposer: BriefingComposer;

  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly eventDispatcher: EventDispatcher;

  readonly clock: Clock;
  readonly settings: ResolvedSettings;
}

export const composeRoot = (inputs: CompositionRootInputs): CompositionRoot => {
  const redis = inputs.redis ?? buildInMemoryRedisGateway();
  const clock = inputs.clock ?? systemClock;
  const events = buildRedisEventStore(redis);
  const activeRules = buildActiveRulesProjection(redis);
  const auditTimeline = buildAuditTimelineProjection(redis);
  const briefingFeed = buildBriefingFeed(redis);
  const leaderboard = buildEffectivenessLeaderboard(redis);
  const conflictMap = buildConflictMap(redis);
  const templateGallery = buildTemplateGallery();
  const devvitAdapter = inputs.devvitAdapter ?? buildFakeDevvitAdapter();

  const llmClient =
    inputs.llmClient ??
    (inputs.openaiApiKey
      ? buildOpenAiLLMClient({ apiKey: inputs.openaiApiKey })
      : { invoke: async () => ({ kind: 'rawText', text: 'no-llm-configured' as const }) });
  const compiler = buildCompilerService(llmClient);

  const rollback = buildRollbackTokenService({ redis, clock });
  const consensus = buildConsensusCoordinator({ redis, events, clock });
  const circuitBreaker = buildCircuitBreakerService({ redis, events, clock });
  const undoLearning = buildUndoLearningStrategy(redis);
  const adaptiveShadow = buildAdaptiveShadowOrchestrator({ activeRules, events, clock });

  const effectivenessScorer = buildEffectivenessScorer({ events, activeRules, leaderboard, clock });
  const conflictDetector = buildConflictDetector({ activeRules, conflictMap, events, clock });
  const whatIfStudio = buildWhatIfStudio({ events, activeRules });
  const suggestionEngine = buildSuggestionEngine({ events, clock });
  const briefingComposer = buildBriefingComposer({ events, briefingFeed, clock });

  const eventDispatcher = buildEventDispatcher({
    activeRules,
    auditTimeline,
    briefingFeed,
    leaderboard,
  });
  const commandBus = buildCommandBus({
    events,
    activeRules,
    auditTimeline,
    compiler,
    consensus,
    rollback,
    clock,
  });
  const queryBus = buildQueryBus({
    activeRules,
    auditTimeline,
    briefingFeed,
    leaderboard,
    conflictMap,
    templateGallery,
  });

  return {
    redis,
    events,
    activeRules,
    auditTimeline,
    briefingFeed,
    leaderboard,
    conflictMap,
    templateGallery,
    devvitAdapter,

    compiler,
    rollback,
    consensus,
    circuitBreaker,
    undoLearning,
    adaptiveShadow,

    effectivenessScorer,
    conflictDetector,
    whatIfStudio,
    suggestionEngine,
    briefingComposer,

    commandBus,
    queryBus,
    eventDispatcher,

    clock,
    settings: inputs.settings,
  };
};

/** Default settings used by tests; production reads from Devvit `settings`. */
export const defaultSettings = (): ResolvedSettings => ({
  sandboxMode: true,
  adaptiveShadow: true,
  shadowConfidenceThreshold: buildConfidence(0.92),
  shadowMinObservations: 25,
  shadowMaxHours: 72,
  perRuleActionCeiling: 50,
  subwideActionCeiling: 200,
  rolloutPercent: brandPercent(100),
  consensusRequired: 'risky',
  rollbackWindowDays: 30,
  compilerModel: 'gpt-5.4-mini',
  compilerVerbosity: 'balanced',
});
