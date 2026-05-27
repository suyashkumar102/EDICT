import { settings as devvitSettings } from '@devvit/web/server';

import { buildConfidence } from '@domain/values/ConfidenceScore';
import { brandPercent } from '@shared/types/BrandedPrimitives';
import type { ConsensusMode } from '@domain/policies/ConsensusPolicy';
import { defaultSettings, type ResolvedSettings } from '@bootstrap/CompositionRoot';

/**
 * Reads the live Devvit settings (defined in `devvit.json` under
 * `settings.global` and `settings.subreddit`) and projects them onto
 * EDICT's typed `ResolvedSettings` shape.
 *
 * `select`-type settings come back from Devvit as `string[]` (the
 * selected values, in user-defined order). We coerce the single-select
 * fields by reading `[0]`. Number / boolean fields come back as their
 * own types. Anything missing falls back to the documented default,
 * which is also what the schema-time `defaultValue` in `devvit.json`
 * encodes; reading the default twice is harmless and keeps the loader
 * robust if Devvit ever changes the underlying types.
 */

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const readSelect = async (key: string, fallback: string): Promise<string> => {
  try {
    const raw = await devvitSettings.get(key);
    if (typeof raw === 'string') return raw;
    if (isStringArray(raw) && raw.length > 0) return raw[0] ?? fallback;
    return fallback;
  } catch {
    return fallback;
  }
};

const readBoolean = async (key: string, fallback: boolean): Promise<boolean> => {
  try {
    const raw = await devvitSettings.get(key);
    return typeof raw === 'boolean' ? raw : fallback;
  } catch {
    return fallback;
  }
};

const readNumber = async (key: string, fallback: number): Promise<number> => {
  try {
    const raw = await devvitSettings.get(key);
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
};

const clampUnit = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clampPercent = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export const resolveSettingsFromDevvit = async (): Promise<ResolvedSettings> => {
  const fallback = defaultSettings();
  const [
    sandboxMode,
    adaptiveShadow,
    shadowConfidenceThreshold,
    shadowMinObservations,
    shadowMaxHours,
    perRuleActionCeiling,
    subwideActionCeiling,
    rolloutPercent,
    consensusRequired,
    rollbackWindowDays,
    compilerModel,
    compilerVerbosity,
  ] = await Promise.all([
    readBoolean('sandboxMode', fallback.sandboxMode),
    readBoolean('adaptiveShadow', fallback.adaptiveShadow),
    readNumber('shadowConfidenceThreshold', fallback.shadowConfidenceThreshold),
    readNumber('shadowMinObservations', fallback.shadowMinObservations),
    readNumber('shadowMaxHours', fallback.shadowMaxHours),
    readNumber('perRuleActionCeiling', fallback.perRuleActionCeiling),
    readNumber('subwideActionCeiling', fallback.subwideActionCeiling),
    readNumber('rolloutPercent', fallback.rolloutPercent),
    readSelect('consensusRequired', fallback.consensusRequired),
    readNumber('rollbackWindowDays', fallback.rollbackWindowDays),
    readSelect('compilerModel', fallback.compilerModel),
    readSelect('compilerVerbosity', fallback.compilerVerbosity),
  ]);

  return {
    sandboxMode,
    adaptiveShadow,
    shadowConfidenceThreshold: buildConfidence(clampUnit(shadowConfidenceThreshold)),
    shadowMinObservations: Math.max(1, Math.trunc(shadowMinObservations)),
    shadowMaxHours: Math.max(1, Math.trunc(shadowMaxHours)),
    perRuleActionCeiling: Math.max(1, Math.trunc(perRuleActionCeiling)),
    subwideActionCeiling: Math.max(1, Math.trunc(subwideActionCeiling)),
    rolloutPercent: brandPercent(clampPercent(rolloutPercent)),
    consensusRequired: (consensusRequired as ConsensusMode) ?? fallback.consensusRequired,
    rollbackWindowDays: Math.max(1, Math.trunc(rollbackWindowDays)),
    compilerModel,
    compilerVerbosity:
      (compilerVerbosity as ResolvedSettings['compilerVerbosity']) ?? fallback.compilerVerbosity,
  };
};

/**
 * Reads the OpenAI / Gemini API keys + the `compilerProvider` selector
 * from the global secrets store and returns the credential set EDICT
 * should wire into the compiler.
 *
 * Both OpenAI and Gemini are on Reddit's approved AI provider list
 * (PR #96). The moderator picks one in Install Settings; whichever key
 * is set wins, and if both are set the explicit `compilerProvider`
 * select decides. If neither is set we return `null` and the
 * composition root keeps the no-LLM stub.
 *
 * Note: Anthropic / Claude is **not** on the approved list and is not
 * wired here. See `documentation/CUT-LIST.md` hard lock #4 for the
 * rationale and `tooling/Doctor.ts` for the regression-guard.
 */
export interface ResolvedLLMCredentials {
  readonly provider: 'openai' | 'gemini';
  readonly apiKey: string;
}

const readSecret = async (key: string): Promise<string | null> => {
  try {
    const raw = await devvitSettings.get(key);
    if (typeof raw === 'string' && raw.trim() !== '') return raw;
    return null;
  } catch {
    return null;
  }
};

export const resolveLLMCredentials = async (): Promise<ResolvedLLMCredentials | null> => {
  const [openai, gemini, providerPref] = await Promise.all([
    readSecret('openaiApiKey'),
    readSecret('geminiApiKey'),
    readSelect('compilerProvider', 'openai'),
  ]);

  if (providerPref === 'openai' && openai) return { provider: 'openai', apiKey: openai };
  if (providerPref === 'gemini' && gemini) return { provider: 'gemini', apiKey: gemini };
  // No explicit preference match — fall back to whichever key is set.
  if (openai) return { provider: 'openai', apiKey: openai };
  if (gemini) return { provider: 'gemini', apiKey: gemini };
  return null;
};

/**
 * Defends against provider/model mismatch (e.g. provider=gemini but the
 * `compilerModel` dropdown still has `gpt-5.4-mini`). When the resolved
 * model doesn't belong to the chosen provider, we swap to a sensible
 * default for that provider and log the override. This keeps Install
 * Settings forgiving — moderators shouldn't have to update two
 * dropdowns in lockstep.
 */
export const alignModelToProvider = (model: string, provider: 'openai' | 'gemini'): string => {
  const lower = model.toLowerCase();
  const isOpenAi = lower.startsWith('gpt-');
  const isGemini = lower.startsWith('gemini-');

  if (provider === 'openai' && !isOpenAi) {
    // eslint-disable-next-line no-console
    console.warn(
      `[edict] model "${model}" does not match provider=openai — falling back to gpt-5.4-mini. Update compilerModel in Install Settings to silence.`,
    );
    return 'gpt-5.4-mini';
  }
  if (provider === 'gemini' && !isGemini) {
    // eslint-disable-next-line no-console
    console.warn(
      `[edict] model "${model}" does not match provider=gemini — falling back to gemini-2.5-flash. Update compilerModel in Install Settings to silence.`,
    );
    return 'gemini-2.5-flash';
  }
  return model;
};

/**
 * Back-compat single-key reader, used by callers that only care whether
 * the OpenAI key exists (e.g. legacy smoketest tooling). New code should
 * call `resolveLLMCredentials` instead.
 */
export const resolveOpenAiApiKey = async (): Promise<string | null> => readSecret('openaiApiKey');
