-- Helpers for the personal seed files in db/seed_personal/, which include this file with
--   \ir ../seed_helpers.sql
-- They're temporary functions (pg_temp), gone when the psql session ends.
--
-- Library items are matched on their exact text: a match is reused, otherwise a row is
-- added. Every item used is also listed under its parent (section, category, role, or
-- project) if it isn't already, at the end of that list. A lookup that matches more than
-- one row raises an error, so the whole seed file rolls back.
--
-- The document helpers work for resumes and cover letters alike: pass doc = 'resume' or
-- 'cover_letter'. Their join tables share names apart from that prefix (resume_section /
-- cover_letter_section, resume_bullet_point / cover_letter_bullet_point, and so on).

-- Find a single-text item (bullet, sentence, skill, skill category) by exact text, or add it.
CREATE FUNCTION pg_temp.item(tbl text, id_col text, text_col text, val text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    EXECUTE format('SELECT %I FROM %I WHERE %I = $1', id_col, tbl, text_col)
        INTO STRICT found_id USING val;
    RETURN found_id;
EXCEPTION WHEN no_data_found THEN
    EXECUTE format('INSERT INTO %I (account_id, %I) VALUES ((SELECT account_id FROM account), $1)'
                   ' RETURNING %I', tbl, text_col, id_col)
        INTO found_id USING val;
    RETURN found_id;
END $$;

-- List a child under a parent in a library join table, at the end. Skips it if listed.
CREATE FUNCTION pg_temp.list(tbl text, parent_col text, parent_id integer,
                             child_col text, child_id integer) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('INSERT INTO %1$I (%2$I, %3$I, position)'
                   ' SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM %1$I WHERE %2$I = $1'
                   ' ON CONFLICT DO NOTHING', tbl, parent_col, child_col)
        USING parent_id, child_id;
END $$;

-- A header version (name, headline, contact details): every field must match.
CREATE FUNCTION pg_temp.header(name text, headline_text text, mail text, phone_number text,
                               loc text, linkedin text, github text DEFAULT NULL,
                               portfolio text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    SELECT header_id INTO STRICT found_id FROM header
    WHERE full_name = name AND headline IS NOT DISTINCT FROM headline_text
      AND email IS NOT DISTINCT FROM mail AND phone IS NOT DISTINCT FROM phone_number
      AND location IS NOT DISTINCT FROM loc AND linkedin_url IS NOT DISTINCT FROM linkedin
      AND github_url IS NOT DISTINCT FROM github AND portfolio_url IS NOT DISTINCT FROM portfolio;
    RETURN found_id;
EXCEPTION WHEN no_data_found THEN
    INSERT INTO header (account_id, full_name, headline, email, phone, location, linkedin_url,
                        github_url, portfolio_url)
    VALUES ((SELECT account_id FROM account), name, headline_text, mail, phone_number, loc,
            linkedin, github, portfolio)
    RETURNING header_id INTO found_id;
    RETURN found_id;
END $$;

-- A role version: every displayed field must match. find_ fails if it's missing.
CREATE FUNCTION pg_temp.find_experience(title text, org_name text, loc text, date_text text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    SELECT experience_id INTO STRICT found_id FROM experience
    WHERE role_title = title AND organization = org_name
      AND location IS NOT DISTINCT FROM loc AND dates IS NOT DISTINCT FROM date_text;
    RETURN found_id;
END $$;

CREATE FUNCTION pg_temp.experience(title text, org_name text, loc text, date_text text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    RETURN pg_temp.find_experience(title, org_name, loc, date_text);
EXCEPTION WHEN no_data_found THEN
    INSERT INTO experience (account_id, role_title, organization, location, dates)
    VALUES ((SELECT account_id FROM account), title, org_name, loc, date_text)
    RETURNING experience_id INTO found_id;
    RETURN found_id;
END $$;

CREATE FUNCTION pg_temp.project(title text, link text, date_text text,
                                done_for_text text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    SELECT project_id INTO STRICT found_id FROM project
    WHERE project_title = title AND url IS NOT DISTINCT FROM link
      AND dates IS NOT DISTINCT FROM date_text AND done_for IS NOT DISTINCT FROM done_for_text;
    RETURN found_id;
EXCEPTION WHEN no_data_found THEN
    INSERT INTO project (account_id, project_title, done_for, url, dates)
    VALUES ((SELECT account_id FROM account), title, done_for_text, link, date_text)
    RETURNING project_id INTO found_id;
    RETURN found_id;
END $$;

CREATE FUNCTION pg_temp.education(deg text, inst text, extra text, grad text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    SELECT education_id INTO STRICT found_id FROM education
    WHERE degree = deg AND institution = inst
      AND details IS NOT DISTINCT FROM extra AND graduation IS NOT DISTINCT FROM grad;
    RETURN found_id;
EXCEPTION WHEN no_data_found THEN
    INSERT INTO education (account_id, degree, institution, details, graduation)
    VALUES ((SELECT account_id FROM account), deg, inst, extra, grad)
    RETURNING education_id INTO found_id;
    RETURN found_id;
END $$;

-- Add a section to a resume or cover letter (found by name) and return its join row id.
CREATE FUNCTION pg_temp.doc_section(doc text, doc_name text, section integer, pos integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE new_id integer;
BEGIN
    EXECUTE format('INSERT INTO %1$I_section (%2$I, section_id, position)'
                   ' VALUES ((SELECT %2$I FROM %1$I WHERE name = $1), $2, $3)'
                   ' RETURNING %1$I_section_id',
                   doc, CASE doc WHEN 'resume' THEN 'resume_id' ELSE 'letter_id' END)
        INTO new_id USING doc_name, section, pos;
    RETURN new_id;
END $$;

CREATE FUNCTION pg_temp.section_of(doc text, ds integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE found_id integer;
BEGIN
    EXECUTE format('SELECT section_id FROM %1$I_section WHERE %1$I_section_id = $1', doc)
        INTO STRICT found_id USING ds;
    RETURN found_id;
END $$;

-- Insert one join row under a document section (or other parent) and return its id.
CREATE FUNCTION pg_temp.place(tbl text, id_col text, cols text[], vals integer[])
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE new_id integer;
BEGIN
    EXECUTE format('INSERT INTO %I (%s) VALUES (%s) RETURNING %I', tbl,
                   (SELECT string_agg(format('%I', c), ', ') FROM unnest(cols) c),
                   (SELECT string_agg(format('$1[%s]', i), ', ')
                    FROM generate_series(1, cardinality(cols)) i),
                   id_col)
        INTO new_id USING vals;
    RETURN new_id;
END $$;

-- Sentences placed directly in a document section, starting at first_pos.
CREATE FUNCTION pg_temp.add_sentences(doc text, ds integer, texts text[],
                                      first_pos integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE id integer;
BEGIN
    FOR i IN 1 .. cardinality(texts) LOOP
        id := pg_temp.item('narrative_content', 'content_id', 'content', texts[i]);
        PERFORM pg_temp.list('section_narrative_content', 'section_id',
                             pg_temp.section_of(doc, ds), 'content_id', id);
        PERFORM pg_temp.place(doc || '_narrative_content', doc || '_narrative_content_id',
                              ARRAY[doc || '_section_id', 'content_id', 'position'],
                              ARRAY[ds, id, first_pos + i - 1]);
    END LOOP;
END $$;

-- Bullets placed directly in a document section (not under a role or project).
CREATE FUNCTION pg_temp.add_bullets(doc text, ds integer, bullets text[],
                                    first_pos integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE id integer;
BEGIN
    FOR i IN 1 .. cardinality(bullets) LOOP
        id := pg_temp.item('bullet_point', 'bullet_id', 'content', bullets[i]);
        PERFORM pg_temp.list('section_bullet_point', 'section_id',
                             pg_temp.section_of(doc, ds), 'bullet_id', id);
        PERFORM pg_temp.place(doc || '_bullet_point', doc || '_bullet_point_id',
                              ARRAY[doc || '_section_id', 'bullet_id', 'position'],
                              ARRAY[ds, id, first_pos + i - 1]);
    END LOOP;
END $$;

-- A skill category and its skills, in order. The built-in "Other" isn't listed in sections.
CREATE FUNCTION pg_temp.add_skill_category(doc text, ds integer, pos integer, name text,
                                           skills text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE cat integer; dcat integer; id integer;
BEGIN
    cat := pg_temp.item('skill_category', 'category_id', 'category_name', name);
    IF cat <> 1 THEN
        PERFORM pg_temp.list('section_skill_category', 'section_id',
                             pg_temp.section_of(doc, ds), 'category_id', cat);
    END IF;
    dcat := pg_temp.place(doc || '_skill_category', doc || '_skill_category_id',
                          ARRAY[doc || '_section_id', 'category_id', 'position'],
                          ARRAY[ds, cat, pos]);
    FOR i IN 1 .. cardinality(skills) LOOP
        id := pg_temp.item('skill', 'skill_id', 'skill_name', skills[i]);
        PERFORM pg_temp.list('skill_category_skill', 'category_id', cat, 'skill_id', id);
        PERFORM pg_temp.place(doc || '_skill', doc || '_skill_id',
                              ARRAY[doc || '_skill_category_id', 'skill_id', 'position'],
                              ARRAY[dcat, id, i]);
    END LOOP;
END $$;

-- List a skill in a category without selecting it in a document.
CREATE FUNCTION pg_temp.list_skill(category text, skill text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.list('skill_category_skill', 'category_id',
                         pg_temp.item('skill_category', 'category_id', 'category_name', category),
                         'skill_id', pg_temp.item('skill', 'skill_id', 'skill_name', skill));
END $$;

-- Set the skills a resume shows under one of its skill categories to exactly this list, in
-- order. Each skill is found or added, and listed under the category.
CREATE FUNCTION pg_temp.set_resume_skills(resume_name text, category text, skills text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rsc integer;
BEGIN
    SELECT x.resume_skill_category_id INTO STRICT rsc
    FROM resume_skill_category x
    JOIN resume_section rs USING (resume_section_id) JOIN resume r USING (resume_id)
    JOIN skill_category c USING (category_id)
    WHERE r.name = resume_name AND c.category_name = category;
    DELETE FROM resume_skill WHERE resume_skill_category_id = rsc;
    FOR i IN 1 .. cardinality(skills) LOOP
        PERFORM pg_temp.list_skill(category, skills[i]);
        INSERT INTO resume_skill (resume_skill_category_id, skill_id, position)
        VALUES (rsc, pg_temp.item('skill', 'skill_id', 'skill_name', skills[i]), i);
    END LOOP;
END $$;

-- A role and its bullets, in order. Returns the experience_id.
CREATE FUNCTION pg_temp.add_job(doc text, ds integer, pos integer, title text,
                                org_name text, loc text, date_text text, bullets text[])
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE role integer; drole integer; id integer;
BEGIN
    role := pg_temp.experience(title, org_name, loc, date_text);
    PERFORM pg_temp.list('section_experience', 'section_id', pg_temp.section_of(doc, ds),
                         'experience_id', role);
    drole := pg_temp.place(doc || '_experience', doc || '_experience_id',
                          ARRAY[doc || '_section_id', 'experience_id', 'position'],
                          ARRAY[ds, role, pos]);
    FOR i IN 1 .. cardinality(bullets) LOOP
        id := pg_temp.item('bullet_point', 'bullet_id', 'content', bullets[i]);
        PERFORM pg_temp.list('experience_bullet_point', 'experience_id', role, 'bullet_id', id);
        PERFORM pg_temp.place(doc || '_bullet_point', doc || '_bullet_point_id',
                              ARRAY[doc || '_section_id', doc || '_experience_id', 'bullet_id',
                                    'position'],
                              ARRAY[ds, drole, id, i]);
    END LOOP;
    RETURN role;
END $$;

-- A new version of a role lists all of the other version's bullets too, after its own.
CREATE FUNCTION pg_temp.share_bullets(from_job integer, to_job integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE id integer;
BEGIN
    FOR id IN SELECT bullet_id FROM experience_bullet_point
              WHERE experience_id = from_job ORDER BY position LOOP
        PERFORM pg_temp.list('experience_bullet_point', 'experience_id', to_job, 'bullet_id', id);
    END LOOP;
END $$;

-- List every skill and bullet of one version of a project under another version, after the
-- ones it already lists, so either version can use any of them.
CREATE FUNCTION pg_temp.share_project(from_proj integer, to_proj integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE id integer;
BEGIN
    FOR id IN SELECT skill_id FROM project_skill WHERE project_id = from_proj ORDER BY position LOOP
        PERFORM pg_temp.list('project_skill', 'project_id', to_proj, 'skill_id', id);
    END LOOP;
    FOR id IN SELECT bullet_id FROM project_bullet_point
              WHERE project_id = from_proj ORDER BY position LOOP
        PERFORM pg_temp.list('project_bullet_point', 'project_id', to_proj, 'bullet_id', id);
    END LOOP;
END $$;

-- A project with its tech list (skills) and bullets, in order.
CREATE FUNCTION pg_temp.add_project(doc text, ds integer, pos integer, title text, link text,
                                    date_text text, skills text[], bullets text[],
                                    done_for_text text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE proj integer; dproj integer; id integer;
BEGIN
    proj := pg_temp.project(title, link, date_text, done_for_text);
    PERFORM pg_temp.list('section_project', 'section_id', pg_temp.section_of(doc, ds),
                         'project_id', proj);
    dproj := pg_temp.place(doc || '_project', doc || '_project_id',
                           ARRAY[doc || '_section_id', 'project_id', 'position'],
                           ARRAY[ds, proj, pos]);
    FOR i IN 1 .. cardinality(skills) LOOP
        id := pg_temp.item('skill', 'skill_id', 'skill_name', skills[i]);
        PERFORM pg_temp.list('project_skill', 'project_id', proj, 'skill_id', id);
        PERFORM pg_temp.place(doc || '_project_skill', doc || '_project_skill_id',
                              ARRAY[doc || '_project_id', 'skill_id', 'position'],
                              ARRAY[dproj, id, i]);
    END LOOP;
    FOR i IN 1 .. cardinality(bullets) LOOP
        id := pg_temp.item('bullet_point', 'bullet_id', 'content', bullets[i]);
        PERFORM pg_temp.list('project_bullet_point', 'project_id', proj, 'bullet_id', id);
        PERFORM pg_temp.place(doc || '_bullet_point', doc || '_bullet_point_id',
                              ARRAY[doc || '_section_id', doc || '_project_id', 'bullet_id',
                                    'position'],
                              ARRAY[ds, dproj, id, i]);
    END LOOP;
END $$;

CREATE FUNCTION pg_temp.add_education(doc text, ds integer, pos integer, deg text, inst text,
                                      extra text, grad text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE id integer;
BEGIN
    id := pg_temp.education(deg, inst, extra, grad);
    PERFORM pg_temp.list('section_education', 'section_id', pg_temp.section_of(doc, ds),
                         'education_id', id);
    PERFORM pg_temp.place(doc || '_education', doc || '_education_id',
                          ARRAY[doc || '_section_id', 'education_id', 'position'],
                          ARRAY[ds, id, pos]);
END $$;
