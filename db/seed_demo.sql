-- Demo data: a made-up front end engineer, Riley Moreno, for screenshots, recordings, and
-- (in phase 6) demo accounts. Every person, organization, and link here is fictional: email
-- and links use example.com, and the phone number is in the 555-01xx range kept for fiction.
-- Nothing comes from db/seed_personal/, and the text follows docs/WRITING_RULES.md
-- (backend/tests/test_seeds.py checks both the rules and that the file loads).
--
-- What it holds:
--   - a library: roles, projects, skills, bullets, summary and cover letter excerpts,
--     education, two tones, and a few items listed but not used anywhere yet
--   - a base resume and a base cover letter ("Front End")
--   - three job postings: Marigold Health (applied to, with an interview, so its resume and
--     cover letter are locked), Bluefin Learning (resume in progress), and Quarry Street
--     Studio (saved, with a header, nothing started yet)
--
-- It loads only into a database with no account yet. scripts/demo_db.sh builds its own
-- database (resume_tweaker_demo) and runs it, so the user's real applications never show.
-- To run it by hand, from the project folder, on an empty migrated database:
--   $(brew --prefix postgresql@18)/bin/psql -p 5433 -d resume_tweaker_demo -1 -v ON_ERROR_STOP=1 -f db/seed_demo.sql

\ir seed_helpers.sql

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM account) THEN
        RAISE EXCEPTION 'The demo data loads only into a database with no account yet.';
    END IF;
END $$;

INSERT INTO account DEFAULT VALUES;

-- The writing rules and "Sincerely", as every new account gets.
\ir seed_defaults.sql

INSERT INTO section (account_id, title)
SELECT (SELECT account_id FROM account), title
FROM (VALUES ('Volunteer Experience'), ('Opening paragraph'), ('Experience paragraph'),
             ('Accessibility paragraph'), ('Closing paragraph')) AS t(title);

INSERT INTO tone_set (account_id, name)
VALUES ((SELECT account_id FROM account), 'Tech'),
       ((SELECT account_id FROM account), 'Public sector');

INSERT INTO tone_rule (tone_set_id, rule_text, position)
SELECT t.tone_set_id, r.rule_text, r.position
FROM tone_set t
JOIN (VALUES
    ('Tech', 'Lead with the tool or the result, then the context.', 1),
    ('Tech', 'Use numbers when the library has them.', 2),
    ('Tech', 'Keep bullets to one line where possible.', 3),
    ('Public sector', 'Name who benefited (patients, patrons, students) before the tools.', 1),
    ('Public sector', 'Use plain words, and spell out acronyms the first time.', 2)
) AS r(tone, rule_text, position) ON r.tone = t.name;

-- Job postings, each with the header chosen for it.
INSERT INTO job_posting (account_id, url, organization, role_title, header_id, applied_on,
                         contacts, description, created_at, updated_at)
VALUES
    ((SELECT account_id FROM account),
     'https://jobs.example.com/marigold-health/senior-front-end-engineer',
     'Marigold Health', 'Senior Front End Engineer',
     pg_temp.header('Riley Moreno', 'Senior Front End Engineer', 'riley.moreno@example.com',
                    '(503) 555-0142', 'Portland, OR', NULL, NULL,
                    'https://rileymoreno.example.com'),
     '2026-10-14',
     'Dana Okafor, Engineering Manager (dana.okafor@example.com)',
     'Marigold Health builds the patient portal that 200 clinics use for appointments, test '
     'results, and messages with their care teams.

About the role
We''re hiring a senior front end engineer to join the portal team. You''ll own features from '
     'design review to release and set the bar for accessibility across the product.

What you''ll do
- Build and maintain patient-facing features in React and TypeScript
- Lead accessibility work: audits, fixes, and automated checks in CI
- Review code and mentor engineers on the team
- Work with design and product to turn research into clear, usable screens

What we''re looking for
- 4+ years building production web apps with React and TypeScript
- Hands-on experience meeting WCAG 2.1 or 2.2 AA
- Experience with end-to-end testing (Playwright or Cypress)
- Healthcare or other regulated industry experience is a plus

Remote within the US. Salary range $145,000 - $170,000.',
     '2026-10-09', '2026-10-14'),
    ((SELECT account_id FROM account),
     'https://jobs.example.com/bluefin-learning/accessibility-engineer',
     'Bluefin Learning', 'Accessibility Engineer',
     pg_temp.header('Riley Moreno', 'Accessibility Engineer', 'riley.moreno@example.com',
                    '(503) 555-0142', 'Portland, OR', NULL, NULL,
                    'https://rileymoreno.example.com'),
     NULL, NULL,
     'Bluefin Learning makes online courses for community colleges, used by 300,000 students '
     'each term.

The role
Our first dedicated accessibility engineer will work across the course player, the authoring '
     'tools, and the design system. You''ll find and fix barriers, teach other engineers how to '
     'avoid them, and build the checks that keep them from coming back.

You have
- Deep knowledge of WCAG 2.2 and ARIA, and when not to use ARIA
- Experience testing with screen readers (NVDA, JAWS, VoiceOver) and the keyboard alone
- Strong HTML, CSS, and JavaScript; React experience preferred
- Experience adding accessibility tests to CI (axe-core, Playwright)
- Clear writing: you''ll write guidance that other teams follow

Hybrid, Portland, OR (two days a week in the office).',
     '2026-11-02', '2026-11-02'),
    ((SELECT account_id FROM account),
     'https://jobs.example.com/quarry-street-studio/front-end-developer',
     'Quarry Street Studio', 'Front End Developer',
     pg_temp.header('Riley Moreno', 'Front End Engineer', 'riley.moreno@example.com',
                    '(503) 555-0142', 'Portland, OR', NULL, NULL,
                    'https://rileymoreno.example.com'),
     NULL, NULL,
     'Quarry Street Studio is a 12-person agency that builds websites for nonprofits and local '
     'governments.

We need a front end developer to build sites from our designers'' Figma files, mostly in '
     'Astro and React, with a headless CMS. Our clients serve the public, so every site we ship '
     'must meet WCAG 2.1 AA.

Requirements
- 3+ years of front end development
- Semantic HTML and modern CSS (grid, custom properties, container queries)
- Some JavaScript framework experience (React, Vue, or Svelte)
- Comfortable talking with clients and explaining technical tradeoffs

Nice to have
- Experience with a headless CMS (Sanity, Contentful, or Strapi)
- Experience with public sector or nonprofit clients

On-site in Portland, OR.',
     '2026-11-06', '2026-11-06');

INSERT INTO interview (account_id, interview_on, notes)
VALUES ((SELECT account_id FROM account), '2026-10-28',
        'Phone screen with Dana Okafor. She asked about the accessibility audit and the booking '
        'flow rebuild. Next step: a technical interview with two engineers on the portal team.');

INSERT INTO job_posting_interview (job_posting_id, interview_id)
SELECT (SELECT job_posting_id FROM job_posting WHERE organization = 'Marigold Health'),
       (SELECT interview_id FROM interview);

INSERT INTO resume (account_id, name, header_id, tone_set_id, created_at, updated_at)
VALUES ((SELECT account_id FROM account), 'Front End',
        pg_temp.header('Riley Moreno', 'Front End Engineer', 'riley.moreno@example.com',
                       '(503) 555-0142', 'Portland, OR', NULL, NULL,
                       'https://rileymoreno.example.com'),
        (SELECT tone_set_id FROM tone_set WHERE name = 'Tech'),
        '2026-09-20', '2026-10-05');

-- The base resume, which also adds most of the library.
DO $$
DECLARE
    resume_name CONSTANT text := 'Front End';
    volunteer CONSTANT integer := (SELECT id FROM section WHERE title = 'Volunteer Experience');
    s integer;
BEGIN
    s := pg_temp.doc_section('resume', resume_name, 1, 1);
    PERFORM pg_temp.add_sentences('resume', s, ARRAY[
        'Front end engineer with four years of experience building accessible React and '
        'TypeScript apps for public-facing services.',
        'Started on a county library''s web team, building pages for patrons of every age and '
        'ability.',
        'Tests every screen with a keyboard and a screen reader before it ships, and adds '
        'automated checks so it stays that way.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 2, 2);
    PERFORM pg_temp.add_skill_category('resume', s, 1, 'Front End', ARRAY[
        'TypeScript', 'React', 'HTML', 'CSS']);
    PERFORM pg_temp.add_skill_category('resume', s, 2, 'Testing & Accessibility', ARRAY[
        'Vitest', 'Playwright', 'axe-core', 'WCAG 2.2', 'Screen reader testing']);
    PERFORM pg_temp.add_skill_category('resume', s, 3, 'Back End', ARRAY[
        'Node.js', 'Python', 'PostgreSQL']);
    PERFORM pg_temp.add_skill_category('resume', s, 4, 'Tools', ARRAY[
        'Git', 'GitHub Actions', 'Figma']);
    PERFORM pg_temp.add_skill_category('resume', s, 5, 'Other', ARRAY[
        'Spanish (conversational)']);

    s := pg_temp.doc_section('resume', resume_name, 3, 3);
    PERFORM pg_temp.add_job('resume', s, 1, 'Front End Engineer', 'Ferncastle Software',
        'Remote', 'Mar 2022 - Present', ARRAY[
        'Rebuilt the appointment booking flow in React and TypeScript, cutting abandoned '
        'bookings by 18%.',
        'Led an accessibility audit of 40 screens and fixed 120 WCAG 2.2 AA issues over two '
        'quarters.',
        'Added Playwright and axe-core checks to CI, so accessibility regressions now fail the '
        'build.',
        'Built a shared component library in Storybook that three product teams use.'
    ]);
    PERFORM pg_temp.add_job('resume', s, 2, 'Web Developer', 'Harbor County Library',
        'Portland, OR', 'Jun 2019 - Feb 2022', ARRAY[
        'Built the library''s event calendar in React, used by about 9,000 patrons a month.',
        'Rewrote the catalog search pages to meet WCAG 2.1 AA, testing each change with patrons '
        'who use screen readers.',
        'Cut home page load time from 6 seconds to under 2 by compressing images and removing '
        'unused scripts.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 4, 4);
    PERFORM pg_temp.add_project('resume', s, 1, 'Trailhead Finder',
        'https://rileymoreno.example.com/trailhead-finder', 'Spring 2024',
        ARRAY['React', 'TypeScript', 'Leaflet', 'PostgreSQL'], ARRAY[
        'Map search for 600 Oregon trailheads, with filters for distance, difficulty, and '
        'wheelchair access.',
        'Every map control works from the keyboard, and screen readers announce the result '
        'count as filters change.'
    ]);
    PERFORM pg_temp.add_project('resume', s, 2, 'Plain Language Checker',
        'https://rileymoreno.example.com/plain-language-checker', '2023',
        ARRAY['Python', 'GitHub Actions'], ARRAY[
        'Command-line tool that flags long sentences and jargon in documentation, run as a '
        'GitHub Action on pull requests.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, volunteer, 5);
    PERFORM pg_temp.add_job('resume', s, 1, 'Coding Mentor', 'Open Door Code Club',
        'Portland, OR', '2020 - Present', ARRAY[
        'Teach a weekly HTML and CSS class for adults changing careers.',
        'Wrote a 10-lesson beginner course that four other mentors now teach from.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 5, 6);
    PERFORM pg_temp.add_education('resume', s, 1, 'B.S. in Computer Science',
        'Columbia Ridge University', NULL, 'May 2019');
END $$;

-- Library items listed but not used in the base resume, so suggestions have more to choose
-- from.
DO $$
DECLARE
    ferncastle CONSTANT integer := pg_temp.find_experience('Front End Engineer',
        'Ferncastle Software', 'Remote', 'Mar 2022 - Present');
    library CONSTANT integer := pg_temp.find_experience('Web Developer', 'Harbor County Library',
        'Portland, OR', 'Jun 2019 - Feb 2022');
BEGIN
    PERFORM pg_temp.list('experience_bullet_point', 'experience_id', ferncastle, 'bullet_id',
        pg_temp.item('bullet_point', 'bullet_id', 'content',
            'Mentored two junior engineers through their first production releases.'));
    PERFORM pg_temp.list('experience_bullet_point', 'experience_id', ferncastle, 'bullet_id',
        pg_temp.item('bullet_point', 'bullet_id', 'content',
            'Moved the front end build from Webpack to Vite, cutting local start-up time from 40 '
            'seconds to 3.'));
    PERFORM pg_temp.list('experience_bullet_point', 'experience_id', library, 'bullet_id',
        pg_temp.item('bullet_point', 'bullet_id', 'content',
            'Trained 25 branch staff to update their own pages in the content management '
            'system.'));
    PERFORM pg_temp.list('project_bullet_point', 'project_id',
        pg_temp.project('Plain Language Checker',
                        'https://rileymoreno.example.com/plain-language-checker', '2023'),
        'bullet_id',
        pg_temp.item('bullet_point', 'bullet_id', 'content',
            'Harbor County Library runs it on every new web page before it goes live.'));
    PERFORM pg_temp.list_skill('Front End', 'Leaflet');  -- first added as a project skill
    PERFORM pg_temp.list_skill('Front End', 'Vite');
    PERFORM pg_temp.list_skill('Front End', 'Astro');
    PERFORM pg_temp.list_skill('Testing & Accessibility', 'ARIA');
    PERFORM pg_temp.list_skill('Back End', 'REST APIs');
END $$;

INSERT INTO cover_letter (account_id, name, header_id, tone_set_id, addressee, sign_off_id,
                          created_at, updated_at)
VALUES ((SELECT account_id FROM account), 'Front End',
        pg_temp.header('Riley Moreno', 'Front End Engineer', 'riley.moreno@example.com',
                       '(503) 555-0142', 'Portland, OR', NULL, NULL,
                       'https://rileymoreno.example.com'),
        (SELECT tone_set_id FROM tone_set WHERE name = 'Tech'), 'Hiring Team',
        (SELECT sign_off_id FROM sign_off WHERE text = 'Sincerely'),
        '2026-09-22', '2026-10-05');

DO $$
DECLARE
    letter_name CONSTANT text := 'Front End';
    s integer;
BEGIN
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Opening paragraph'), 1);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'I build front end apps that work for everyone who uses them, including people who '
        'navigate with a keyboard or a screen reader.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Experience paragraph'), 2);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'At Ferncastle Software, I rebuilt the appointment booking flow that clinics use to '
        'schedule patients, and abandoned bookings dropped by 18%.',
        'Before that, I spent three years on the Harbor County Library web team, where I learned '
        'to test with the people who use a site every day.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Accessibility paragraph'), 3);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'I treat accessibility as part of the definition of done. On my current team, I added '
        'automated checks to our CI pipeline, so regressions fail the build instead of reaching '
        'users.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Closing paragraph'), 4);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'I would welcome the chance to talk about the work your team has planned. Thank you for '
        'your time.'
    ]);
END $$;

-- Marigold Health: sent, so both versions are locked. Each starts from its base version, with
-- a summary sentence and a bullet reworded for this posting (new library rows; the originals
-- stay).
INSERT INTO resume (account_id, job_posting_id, name, header_id, tone_set_id, based_on_resume_id,
                    created_at, updated_at)
SELECT p.account_id, p.job_posting_id, 'Senior Front End Engineer at Marigold Health',
       p.header_id, (SELECT tone_set_id FROM tone_set WHERE name = 'Tech'),
       (SELECT resume_id FROM resume WHERE name = 'Front End'), '2026-10-10', '2026-10-13'
FROM job_posting p WHERE p.organization = 'Marigold Health';

DO $$
DECLARE
    resume_name CONSTANT text := 'Senior Front End Engineer at Marigold Health';
    s integer;
BEGIN
    s := pg_temp.doc_section('resume', resume_name, 1, 1);
    PERFORM pg_temp.add_sentences('resume', s, ARRAY[
        'Front end engineer with four years of experience building accessible React and '
        'TypeScript apps, most recently for clinics and their patients.',
        'Tests every screen with a keyboard and a screen reader before it ships, and adds '
        'automated checks so it stays that way.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 2, 2);
    PERFORM pg_temp.add_skill_category('resume', s, 1, 'Front End', ARRAY[
        'TypeScript', 'React', 'HTML', 'CSS']);
    PERFORM pg_temp.add_skill_category('resume', s, 2, 'Testing & Accessibility', ARRAY[
        'Playwright', 'axe-core', 'WCAG 2.2', 'Screen reader testing']);
    PERFORM pg_temp.add_skill_category('resume', s, 3, 'Back End', ARRAY[
        'Node.js', 'PostgreSQL']);

    s := pg_temp.doc_section('resume', resume_name, 3, 3);
    PERFORM pg_temp.add_job('resume', s, 1, 'Front End Engineer', 'Ferncastle Software',
        'Remote', 'Mar 2022 - Present', ARRAY[
        'Rebuilt the patient appointment booking flow in React and TypeScript, cutting '
        'abandoned bookings by 18%.',
        'Led an accessibility audit of 40 screens and fixed 120 WCAG 2.2 AA issues over two '
        'quarters.',
        'Added Playwright and axe-core checks to CI, so accessibility regressions now fail the '
        'build.',
        'Mentored two junior engineers through their first production releases.'
    ]);
    PERFORM pg_temp.add_job('resume', s, 2, 'Web Developer', 'Harbor County Library',
        'Portland, OR', 'Jun 2019 - Feb 2022', ARRAY[
        'Rewrote the catalog search pages to meet WCAG 2.1 AA, testing each change with patrons '
        'who use screen readers.',
        'Built the library''s event calendar in React, used by about 9,000 patrons a month.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 4, 4);
    PERFORM pg_temp.add_project('resume', s, 1, 'Trailhead Finder',
        'https://rileymoreno.example.com/trailhead-finder', 'Spring 2024',
        ARRAY['React', 'TypeScript', 'PostgreSQL'], ARRAY[
        'Every map control works from the keyboard, and screen readers announce the result '
        'count as filters change.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 5, 5);
    PERFORM pg_temp.add_education('resume', s, 1, 'B.S. in Computer Science',
        'Columbia Ridge University', NULL, 'May 2019');
END $$;

INSERT INTO cover_letter (account_id, job_posting_id, name, header_id, tone_set_id,
                          based_on_letter_id, addressee, sign_off_id, created_at, updated_at)
SELECT p.account_id, p.job_posting_id, 'Senior Front End Engineer at Marigold Health',
       p.header_id, (SELECT tone_set_id FROM tone_set WHERE name = 'Tech'),
       (SELECT letter_id FROM cover_letter WHERE name = 'Front End'), 'Dana Okafor',
       (SELECT sign_off_id FROM sign_off WHERE text = 'Sincerely'), '2026-10-11', '2026-10-13'
FROM job_posting p WHERE p.organization = 'Marigold Health';

DO $$
DECLARE
    letter_name CONSTANT text := 'Senior Front End Engineer at Marigold Health';
    s integer;
BEGIN
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Opening paragraph'), 1);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'Patients open Marigold Health''s portal at stressful moments, and I want to help make '
        'every screen of it easy to use. I''d like to apply for the Senior Front End Engineer '
        'role.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Experience paragraph'), 2);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'At Ferncastle Software, I rebuilt the appointment booking flow that clinics use to '
        'schedule patients, and abandoned bookings dropped by 18%.',
        'I also review most of the front end pull requests on my team and mentor our two '
        'newest engineers.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Accessibility paragraph'), 3);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'I treat accessibility as part of the definition of done. On my current team, I added '
        'automated checks to our CI pipeline, so regressions fail the build instead of reaching '
        'users.'
    ]);
    s := pg_temp.doc_section('cover_letter', letter_name,
        (SELECT id FROM section WHERE title = 'Closing paragraph'), 4);
    PERFORM pg_temp.add_sentences('cover_letter', s, ARRAY[
        'I would welcome the chance to talk about the work your team has planned. Thank you for '
        'your time.'
    ]);
END $$;

-- Bluefin Learning: a resume in progress, started from the base resume, with accessibility
-- moved to the front. No cover letter yet.
INSERT INTO resume (account_id, job_posting_id, name, header_id, tone_set_id, based_on_resume_id,
                    created_at, updated_at)
SELECT p.account_id, p.job_posting_id, 'Accessibility Engineer at Bluefin Learning',
       p.header_id, (SELECT tone_set_id FROM tone_set WHERE name = 'Tech'),
       (SELECT resume_id FROM resume WHERE name = 'Front End'), '2026-11-03', '2026-11-04'
FROM job_posting p WHERE p.organization = 'Bluefin Learning';

DO $$
DECLARE
    resume_name CONSTANT text := 'Accessibility Engineer at Bluefin Learning';
    volunteer CONSTANT integer := (SELECT id FROM section WHERE title = 'Volunteer Experience');
    s integer;
BEGIN
    s := pg_temp.doc_section('resume', resume_name, 1, 1);
    PERFORM pg_temp.add_sentences('resume', s, ARRAY[
        'Tests every screen with a keyboard and a screen reader before it ships, and adds '
        'automated checks so it stays that way.',
        'Front end engineer with four years of experience building accessible React and '
        'TypeScript apps for public-facing services.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 2, 2);
    PERFORM pg_temp.add_skill_category('resume', s, 1, 'Testing & Accessibility', ARRAY[
        'WCAG 2.2', 'ARIA', 'Screen reader testing', 'axe-core', 'Playwright']);
    PERFORM pg_temp.add_skill_category('resume', s, 2, 'Front End', ARRAY[
        'HTML', 'CSS', 'TypeScript', 'React']);

    s := pg_temp.doc_section('resume', resume_name, 3, 3);
    PERFORM pg_temp.add_job('resume', s, 1, 'Front End Engineer', 'Ferncastle Software',
        'Remote', 'Mar 2022 - Present', ARRAY[
        'Led an accessibility audit of 40 screens and fixed 120 WCAG 2.2 AA issues over two '
        'quarters.',
        'Added Playwright and axe-core checks to CI, so accessibility regressions now fail the '
        'build.',
        'Built a shared component library in Storybook that three product teams use.'
    ]);
    PERFORM pg_temp.add_job('resume', s, 2, 'Web Developer', 'Harbor County Library',
        'Portland, OR', 'Jun 2019 - Feb 2022', ARRAY[
        'Rewrote the catalog search pages to meet WCAG 2.1 AA, testing each change with patrons '
        'who use screen readers.',
        'Trained 25 branch staff to update their own pages in the content management system.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, volunteer, 4);
    PERFORM pg_temp.add_job('resume', s, 1, 'Coding Mentor', 'Open Door Code Club',
        'Portland, OR', '2020 - Present', ARRAY[
        'Wrote a 10-lesson beginner course that four other mentors now teach from.'
    ]);

    s := pg_temp.doc_section('resume', resume_name, 5, 5);
    PERFORM pg_temp.add_education('resume', s, 1, 'B.S. in Computer Science',
        'Columbia Ridge University', NULL, 'May 2019');
END $$;
