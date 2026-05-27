# Privacy Policy

**EDICT — Moderation Rule Engine**
**Effective date: May 27, 2026**

---

## 1. Overview

EDICT is a Reddit Devvit application. This Privacy Policy explains what data the App collects, how it is used, and how it is stored. EDICT is designed with a minimal data footprint: the App collects only what is necessary to evaluate moderation rules and maintain an audit trail.

---

## 2. Data We Collect

### 2.1 Rule text

When a moderator composes a rule, the plain-English sentence they type is stored in Devvit's Redis instance associated with the subreddit installation. This text is also sent to the AI provider (OpenAI or Google Gemini) to compile the rule. No other data is sent to the AI provider.

### 2.2 Fact-bag snapshots

When EDICT evaluates a post or comment, it captures a snapshot of the measurable facts used by active rules — for example, post length in characters, account age in days, author karma, and whether the title is in all caps. These snapshots are stored in the subreddit's event log in Devvit Redis for up to 30 days (configurable).

Fact-bag snapshots do not contain post body text, comment text, usernames, or any personally identifiable information beyond numeric and boolean values derived from Reddit's public API.

### 2.3 Event log

Every state change — rule drafted, compiled, activated, action taken, action reversed — is recorded as an immutable event in the subreddit's event log. Events contain:

- A timestamp
- The moderator username who performed the action (for rule lifecycle events)
- The Reddit thing ID (t3\_ or t1\_ prefix) of the post or comment acted on
- The verdict taken
- The fact-bag snapshot at evaluation time

Events are stored in Devvit Redis and are scoped to the subreddit installation.

### 2.4 Rollback tokens

When EDICT takes a reversible action, it stores a rollback token containing the thing ID, the verdict taken, and the original event ID. Tokens expire after the configured rollback window (default 30 days).

### 2.5 API keys

If you configure an OpenAI or Google Gemini API key, it is stored in Devvit's encrypted settings store. EDICT does not log, transmit, or expose API keys beyond their use in compiling rules.

---

## 3. Data We Do Not Collect

EDICT does not collect or store:

- Post body text or comment text
- Usernames of regular community members (only moderator usernames for rule lifecycle events)
- IP addresses
- Browser or device information
- Any data beyond what is described in Section 2

The AI provider receives only the rule text typed by the moderator. Reddit content — posts, comments, usernames — is never sent to any external service.

---

## 4. How Data Is Used

Data collected by EDICT is used exclusively to:

- Evaluate moderation rules against submitted content
- Maintain an audit trail of moderation actions for the subreddit's moderator team
- Enable the What-If Studio to replay rules against historical fact-bag snapshots
- Enable the reversal of moderation actions within the rollback window
- Compute effectiveness scores for active rules

---

## 5. Data Storage and Retention

All data is stored in Devvit's hosted Redis infrastructure, scoped to the subreddit installation. Data is not shared between subreddits.

Event log entries are retained indefinitely unless the subreddit uninstalls the App, at which point Devvit's platform removes the associated Redis data automatically. Rollback tokens expire after the configured window (default 30 days). Circuit breaker counters expire after 90 minutes.

---

## 6. Data Sharing

EDICT does not sell, rent, or share data with third parties, except:

- **AI providers:** The rule text typed by a moderator is sent to OpenAI or Google Gemini (as configured) for compilation. This is governed by the respective provider's privacy policy.
- **Reddit:** EDICT uses Reddit's API to take moderation actions. Reddit's privacy policy governs Reddit's handling of that data.
- **Legal requirements:** EDICT may disclose data if required by law.

---

## 7. Data Access

Moderators of the subreddit can access the event log and audit timeline through the EDICT Command Center. Regular community members have no access to EDICT's stored data.

---

## 8. Children's Privacy

EDICT is a moderation tool intended for use by subreddit moderators. It is not directed at children under 13. EDICT does not knowingly collect data from children.

---

## 9. Changes to This Policy

This Privacy Policy may be updated from time to time. The effective date at the top of this document will reflect the most recent revision. Continued use of the App after changes are posted constitutes acceptance of the updated Policy.

---

## 10. Contact

For questions about this Privacy Policy, open an issue on the EDICT GitHub repository.
