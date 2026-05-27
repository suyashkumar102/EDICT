import { Devvit } from '@devvit/public-api';
import { CommandCenterPost } from '@interface/customposts/CommandCenter/CommandCenter';
import { WhatIfStudioPost } from '@interface/customposts/WhatIfStudio/WhatIfStudio';
import { RuleComposerPost } from '@interface/customposts/RuleComposer/RuleComposer';

/**
 * Custom post entry. Bundled by Vite into
 * `distribution/customposts/Index.js`. devvit.json's `post.entry`
 * points at this file.
 *
 * EDICT ships three custom-post surfaces:
 *   - CommandCenter  — six-tab dashboard, pinned to the subreddit
 *   - WhatIfStudio   — interactive simulator, opens from menu
 *   - RuleComposer   — full-screen composer (vs the modal form), opens from menu
 *
 * Each is registered with a distinct name so the menu can target them
 * independently. The Command Center is also pinable; the other two are
 * transient (opened, used once, closed).
 */

Devvit.addCustomPostType({
  name: 'EDICT Command Center',
  height: 'tall',
  render: CommandCenterPost,
});

Devvit.addCustomPostType({
  name: 'EDICT What-If Studio',
  height: 'regular',
  render: WhatIfStudioPost,
});

Devvit.addCustomPostType({
  name: 'EDICT Rule Composer',
  height: 'tall',
  render: RuleComposerPost,
});

export default Devvit;
