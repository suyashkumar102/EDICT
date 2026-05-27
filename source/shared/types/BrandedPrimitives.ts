/**
 * Nominal-typed primitives so the type checker can tell a `RuleId` from a
 * `ModeratorId` even though both are strings at runtime. Every identifier
 * passing between layers must be branded — string-typing IDs across layer
 * boundaries is a class of bug we never want to debug.
 */

declare const brand: unique symbol;
export type Branded<TBase, TBrand> = TBase & { readonly [brand]: TBrand };

export type RuleId = Branded<string, 'RuleId'>;
export type RuleVersion = Branded<number, 'RuleVersion'>;
export type ULID = Branded<string, 'ULID'>;
export type SubredditId = Branded<string, 'SubredditId'>;
export type ModeratorId = Branded<string, 'ModeratorId'>;
export type ThingId = Branded<string, 'ThingId'>;
export type InstallationId = Branded<string, 'InstallationId'>;
export type TimestampMs = Branded<number, 'TimestampMs'>;

/** 0 ≤ x ≤ 1 — used by ConfidenceScore, EffectivenessScore, RolloutPercent normalised. */
export type UnitInterval = Branded<number, 'UnitInterval'>;

/** Integer 0..100. */
export type Percent = Branded<number, 'Percent'>;

export const brandRuleId = (raw: string): RuleId => raw as RuleId;
export const brandRuleVersion = (raw: number): RuleVersion => raw as RuleVersion;
export const brandULID = (raw: string): ULID => raw as ULID;
export const brandSubredditId = (raw: string): SubredditId => raw as SubredditId;
export const brandModeratorId = (raw: string): ModeratorId => raw as ModeratorId;
export const brandThingId = (raw: string): ThingId => raw as ThingId;
export const brandInstallationId = (raw: string): InstallationId => raw as InstallationId;
export const brandTimestampMs = (raw: number): TimestampMs => raw as TimestampMs;

export const brandUnitInterval = (raw: number): UnitInterval => {
  if (raw < 0 || raw > 1 || Number.isNaN(raw)) {
    throw new RangeError(`UnitInterval out of range: ${raw}`);
  }
  return raw as UnitInterval;
};

export const brandPercent = (raw: number): Percent => {
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
    throw new RangeError(`Percent must be integer in 0..100: ${raw}`);
  }
  return raw as Percent;
};
