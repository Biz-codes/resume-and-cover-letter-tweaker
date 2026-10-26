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
The database will be seeded with the user's existing resume data, which may contain listed words.
- **No automatic changes:** the app doesn't rewrite seeded content on import or without asking.
- **When it shows up in a suggestion:** if a suggested item contains a listed word, the app applies the test above.
  - **Filler:** it suggests a rewording. An accepted rewording is saved as a new bullet point or sentence, and the original stays in the library (see [APP_FLOW.md](APP_FLOW.md)).
  - **Real term:** it leaves the word alone.

## Tone rules
The user can add and adjust rules about tone and pick which set applies to a resume. Different kinds of jobs call for different word choice and sentence structure. For example, a tech resume favors tools, metrics, and short technical bullets, while a teaching resume favors students, outcomes, and collaboration.
