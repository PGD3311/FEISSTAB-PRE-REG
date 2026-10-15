-- 009_syllabus_detail.sql
-- * grades_only competitions (e.g. Future Champ): closed to prelim and open dancers
-- * default dances per level on the system templates, following a typical US syllabus:
--     Beginner      reel, slip jig, single jig, light jig
--     Adv Beginner  + treble jig, hornpipe
--     Novice        reel, slip jig, light jig, treble jig, hornpipe
--     Prizewinner   reel, slip jig, treble jig, hornpipe, trad set (St. Patrick's Day)
--   Only dances that exist in each template are kept.

SET search_path TO pre_registration, public;

ALTER TABLE feis_competitions
  ADD COLUMN IF NOT EXISTS grades_only boolean NOT NULL DEFAULT false;

WITH defaults(level_key, dances) AS (
  VALUES
    ('BG',  ARRAY['reel', 'slip_jig', 'single_jig', 'light_jig']),
    ('AB',  ARRAY['reel', 'slip_jig', 'single_jig', 'light_jig', 'treble_jig', 'hornpipe']),
    ('NOV', ARRAY['reel', 'slip_jig', 'light_jig', 'treble_jig', 'hornpipe']),
    ('PW',  ARRAY['reel', 'slip_jig', 'treble_jig', 'hornpipe', 'st_patricks_day'])
),
per_template AS (
  SELECT t.id,
         jsonb_object_agg(
           d.level_key,
           (SELECT coalesce(jsonb_agg(dance), '[]'::jsonb)
            FROM unnest(d.dances) AS dance
            WHERE t.template_data->'dances' @> jsonb_build_array(jsonb_build_object('key', dance)))
         ) AS level_dances
  FROM syllabus_templates t
  CROSS JOIN defaults d
  WHERE t.is_system
  GROUP BY t.id
)
UPDATE syllabus_templates t
SET template_data = t.template_data || jsonb_build_object('default_level_dances', p.level_dances)
FROM per_template p
WHERE p.id = t.id;
