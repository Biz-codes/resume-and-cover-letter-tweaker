# Writing Rules
Every suggestion the app makes must follow these rules. They're stored in the `writing_rule`, `tone_set`, and `tone_rule` tables (see [DATABASE.md](DATABASE.md)). The lists below are the starting rules each account is seeded with; the user can edit them in the app.

## No filler or AI-speak
The app never uses filler words or phrasing that sounds machine-written. A starting list, to be edited over time:
- **Words:** leverage, utilize, spearhead, synergy, dynamic, passionate, results-driven, detail-oriented, robust, seamless, cutting-edge, delve, tapestry, landscape, realm, foster, elevate, empower, unlock, harness, showcase, testament, pivotal
- **Phrases:** "proven track record", "fast-paced environment", "team player", "think outside the box", "hit the ground running", "wear many hats", "I am writing to express my interest", "I am excited to apply"
- **Patterns:**
  - intensifiers like very, really, highly, extremely
  - "responsible for" and "helped with" instead of an action verb
  - "not only X but also Y"
  - lists of three used for rhythm rather than content
  - em dashes used for drama

### Exceptions: technical terms and proper nouns
Some listed words have real technical or literal meanings. The app must judge each use in context and allow the word when it's one of these:
- **A technical term:** "dynamic programming", "dynamic typing", "test harness", "robust regression", "financial leverage", "elevated privileges", "landscape orientation"
- **A proper noun:** a product, framework, or company name, such as Realm, Apache Tapestry, or Pivotal Tracker
- **The plain literal meaning,** especially outside tech: "foster care" on a social work resume, "landscape design" on a landscaping resume

A quick test: replace the word with a plain one ("use", "strong", "lead", "show"). If the meaning stays the same, it was filler. If the meaning changes or becomes wrong, it's a real term and stays.

Other signals that a word is a real term:
- the job posting uses it in the same technical sense
- it's part of a skill name in the database

### Existing content
The database is seeded with the user's existing resumes and cover letters (and can take more, read from their files), which may contain listed words.
- **No automatic changes:** the app doesn't rewrite seeded content on import or without asking.
- **When it shows up in a suggestion:** if a suggested item contains a listed word, the app applies the test above.
  - **Filler:** it suggests a rewording. An accepted rewording is saved as a new bullet point or narrative content excerpt, and the original stays in the library (see [APP_FLOW.md](APP_FLOW.md)).
  - **Real term:** it leaves the word alone.

### How the app checks
Being built in phase 5 step 3 (see [BUILD_PLAN.md](BUILD_PLAN.md)): Claude's draft of a posting's document is checked (Claude's text fixed, then flagged; library items only flagged), and the chat and the user's own text come next. Until then, the rules reach those in each request's instructions.
- **Terms are found in code:** whole words, ignoring capitals, including a single word's usual endings ("leveraged", "spearheading") and a hyphen written as a space ("results driven"). Finding one only makes it a candidate.
- **Claude judges the rest** in one quick check: whether each found term is filler or a real term (the test above), the patterns, and the document's tone.
- **Claude's own text is fixed first:** filler or a broken pattern in what Claude wrote is reworded before the user sees it. Whatever still breaks a rule is shown with the rule and why, and the user decides.
- **The user's own text is only flagged,** never changed.

## Tone rules
The user can add and adjust rules about tone and pick which set applies to a resume. Different kinds of jobs call for different word choice and sentence structure. For example, a tech resume favors tools, metrics, and short technical bullets, while a teaching resume favors students, outcomes, and collaboration.
