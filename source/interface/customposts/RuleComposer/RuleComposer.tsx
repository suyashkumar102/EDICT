import { Devvit, useState } from '@devvit/public-api';
import { color, typography } from '@interface/theme/DesignTokens';

/**
 * Full-screen Rule Composer custom post.
 *
 * Three vertical sections:
 *   1. Natural-language input.
 *   2. Compiled-rule preview.
 *   3. Decision panel.
 */

interface PreviewClause {
  readonly clauseName: string;
  readonly whenLines: string[];
  readonly unlessLines: string[];
  readonly verdictKind: string;
  readonly verdictDetail: string;
}

const PLACEHOLDER_HINTS: string[] = [
  'Send to mod queue any post under 50 characters from accounts less than 7 days old.',
  'Report posts containing a link to bit.ly or tinyurl.com.',
  'Lock any post whose title is in all caps unless the author karma is above 5000.',
  'When a post has 3+ unique reporters AND is less than 30 minutes old, send to mod queue.',
];

export const RuleComposerPost: Devvit.CustomPostComponent = (context) => {
  const [english, setEnglish] = useState<string>('');
  const [stage, setStage] = useState<'editing' | 'compiling' | 'compiled' | 'clarify'>('editing');
  const [previewJson, setPreviewJson] = useState<string>('[]');
  const [clarifyQuestion, setClarifyQuestion] = useState<string>('');
  const [clarifyOptions, setClarifyOptions] = useState<string>('[]');

  const preview: PreviewClause[] = JSON.parse(previewJson) as PreviewClause[];
  const clarifyOptionsList: string[] = JSON.parse(clarifyOptions) as string[];

  const compile = async (): Promise<void> => {
    if (english.length < 8) {
      context.ui.showToast({ text: 'Write at least one sentence.', appearance: 'neutral' });
      return;
    }
    setStage('compiling');
    setStage('compiled');
    setPreviewJson(JSON.stringify([
      {
        clauseName: 'short low-tenure post',
        whenLines: ['postLengthChars < 50', 'AND accountAgeDays < 7'],
        unlessLines: [],
        verdictKind: 'sendToModQueue',
        verdictDetail: '',
      },
    ]));
  };

  return (
    <vstack gap="medium" padding="medium" backgroundColor={color.surfaceCanvas}>
      <hstack gap="small" alignment="start middle">
        <text size="xxlarge" weight={typography.weightBold} color={color.edictPrimary}>
          Compose a rule
        </text>
      </hstack>

      <hstack gap="medium">
        <vstack grow gap="medium">
          <text size="medium" weight={typography.weightBold}>Plain English</text>
          <button
            appearance="bordered"
            onPress={() =>
              context.ui.navigateTo(
                `/edict/compose?prefill=${encodeURIComponent(PLACEHOLDER_HINTS[Math.floor(Math.random() * PLACEHOLDER_HINTS.length)] ?? '')}`,
              )
            }
          >
            Inspire me
          </button>
          <text size="small" color={color.textMuted}>
            Try multi-clause: combine "WHEN A AND B" with "UNLESS C" and chain THEN actions.
          </text>
          <vstack
            padding="medium"
            backgroundColor={color.surfaceCard}
            cornerRadius="medium"
            border="thin"
            borderColor={color.borderSubtle}
          >
            <text size="medium" color={english ? color.textBody : color.textMuted}>
              {english || PLACEHOLDER_HINTS[0]}
            </text>
          </vstack>
          <hstack gap="small">
            <button appearance="primary" onPress={compile}>
              Compile + What-If
            </button>
            <button appearance="plain" onPress={() => setEnglish('')}>
              Clear
            </button>
          </hstack>
        </vstack>

        <vstack grow gap="medium">
          <text size="medium" weight={typography.weightBold}>Compiled preview</text>
          {stage === 'editing' && (
            <vstack
              padding="medium"
              backgroundColor={color.surfaceCard}
              cornerRadius="medium"
              border="thin"
              borderColor={color.borderSubtle}
              alignment="center middle"
            >
              <text size="small" color={color.textMuted}>
                Compile to see the parsed clauses, combinators, and verdicts.
              </text>
            </vstack>
          )}
          {stage === 'compiling' && <text color={color.textMuted}>Compiling…</text>}
          {stage === 'clarify' && (
            <vstack
              padding="medium"
              backgroundColor={color.surfaceCard}
              cornerRadius="medium"
              border="thin"
              borderColor={color.semanticWarn}
              gap="small"
            >
              <text size="medium" weight={typography.weightBold} color={color.semanticWarn}>
                Clarify
              </text>
              <text size="small" color={color.textBody}>
                {clarifyQuestion}
              </text>
              {clarifyOptionsList.map((o) => (
                <button appearance="bordered" onPress={() => context.ui.navigateTo(`/edict/clarify?choice=${encodeURIComponent(o)}`)}>
                  {o}
                </button>
              ))}
            </vstack>
          )}
          {stage === 'compiled' && (
            <vstack gap="small">
              {preview.map((c) => (
                <vstack
                  padding="medium"
                  backgroundColor={color.surfaceCard}
                  cornerRadius="medium"
                  border="thin"
                  borderColor={color.edictPrimary}
                  gap="small"
                >
                  <text size="medium" weight={typography.weightBold}>
                    {c.clauseName}
                  </text>
                  <text size="small" color={color.textMuted}>WHEN</text>
                  {c.whenLines.map((l) => (
                    <text size="small" color={color.textBody}>
                      • {l}
                    </text>
                  ))}
                  {c.unlessLines.length > 0 && (
                    <>
                      <text size="small" color={color.textMuted}>UNLESS</text>
                      {c.unlessLines.map((l) => (
                        <text size="small" color={color.textBody}>
                          • {l}
                        </text>
                      ))}
                    </>
                  )}
                  <text size="small" color={color.textMuted}>THEN</text>
                  <text size="small" weight={typography.weightBold} color={color.edictPrimary}>
                    {c.verdictKind} {c.verdictDetail}
                  </text>
                </vstack>
              ))}
              <hstack gap="small">
                <button appearance="primary" onPress={() => context.ui.navigateTo('/edict/composer/run-what-if')}>
                  Run What-If
                </button>
                <button appearance="bordered" onPress={() => context.ui.navigateTo('/edict/composer/activate')}>
                  Activate (shadow)
                </button>
                <button appearance="plain" onPress={() => context.ui.navigateTo('/edict/composer/save-draft')}>
                  Save as draft
                </button>
              </hstack>
            </vstack>
          )}
        </vstack>
      </hstack>
    </vstack>
  );
};
