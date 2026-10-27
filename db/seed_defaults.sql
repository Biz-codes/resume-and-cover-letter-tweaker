-- Account defaults: the starting writing rules from docs/WRITING_RULES.md and the
-- "Sincerely" sign-off.
--
-- Each part is added only to accounts that have none yet (no writing rules at all, or no
-- sign-offs at all), so running this again never brings back a rule or sign-off the user
-- deleted or reworded. Run after the first file in db/seed_personal/, from the project folder:
--   $(brew --prefix postgresql@18)/bin/psql -p 5433 -d resume_tweaker -1 -v ON_ERROR_STOP=1 -f db/seed_defaults.sql

INSERT INTO writing_rule (account_id, kind, rule_text)
SELECT a.account_id, r.kind::writing_rule_kind, r.rule_text
FROM account a
CROSS JOIN (VALUES
    -- Words
    ('term', 'leverage'),
    ('term', 'utilize'),
    ('term', 'spearhead'),
    ('term', 'synergy'),
    ('term', 'dynamic'),
    ('term', 'passionate'),
    ('term', 'results-driven'),
    ('term', 'detail-oriented'),
    ('term', 'robust'),
    ('term', 'seamless'),
    ('term', 'cutting-edge'),
    ('term', 'delve'),
    ('term', 'tapestry'),
    ('term', 'landscape'),
    ('term', 'realm'),
    ('term', 'foster'),
    ('term', 'elevate'),
    ('term', 'empower'),
    ('term', 'unlock'),
    ('term', 'harness'),
    ('term', 'showcase'),
    ('term', 'testament'),
    ('term', 'pivotal'),
    -- Phrases
    ('term', 'proven track record'),
    ('term', 'fast-paced environment'),
    ('term', 'team player'),
    ('term', 'think outside the box'),
    ('term', 'hit the ground running'),
    ('term', 'wear many hats'),
    ('term', 'I am writing to express my interest'),
    ('term', 'I am excited to apply'),
    -- Patterns
    ('pattern', 'intensifiers like very, really, highly, extremely'),
    ('pattern', '"responsible for" and "helped with" instead of an action verb'),
    ('pattern', '"not only X but also Y"'),
    ('pattern', 'lists of three used for rhythm rather than content'),
    ('pattern', 'em dashes used for drama')
) AS r(kind, rule_text)
WHERE NOT EXISTS (SELECT 1 FROM writing_rule w WHERE w.account_id = a.account_id);

INSERT INTO sign_off (account_id, text)
SELECT a.account_id, 'Sincerely'
FROM account a
WHERE NOT EXISTS (SELECT 1 FROM sign_off s WHERE s.account_id = a.account_id);
