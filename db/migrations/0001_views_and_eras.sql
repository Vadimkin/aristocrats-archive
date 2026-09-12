-- Views the exporter reads, plus the era reference data.
--
-- Views live in a --custom migration because they are not diffable: changing
-- one means DROP VIEW + CREATE VIEW, which should be a deliberate, reviewable
-- migration rather than something `db:generate` infers. db/schema.js declares
-- them .existing() so queries can still select from them.

-- Layer hand fixes over the derived columns. NULL in an override column means
-- "no opinion". Doing this here rather than in the exporter means an override
-- takes effect on the next `npm run data`, with no re-import.
CREATE VIEW `v_shows` AS
SELECT s.id            AS id,
       s.ord           AS ord,
       COALESCE(o.slug, s.slug) AS slug,
       COALESCE(o.name, s.name) AS name,
       COALESCE(o.host, s.host) AS host
FROM shows s
LEFT JOIN show_overrides o ON o.show_id = s.id;
--> statement-breakpoint

-- `duration` has no derived column to fall back on: it comes from the ffprobe
-- pass in `durations`, with an override winning over it.
CREATE VIEW `v_episodes` AS
SELECT e.id        AS id,
       e.show_id   AS show_id,
       e.ord       AS ord,
       e.path      AS path,
       e.raw_title AS raw_title,
       COALESCE(o.title,    e.title)   AS title,
       COALESCE(o.host,     e.host)    AS host,
       COALESCE(o.date,     e.date)    AS date,
       COALESCE(o.year,     e.year)    AS year,
       COALESCE(o.season,   e.season)  AS season,
       COALESCE(o.episode,  e.episode) AS episode,
       COALESCE(o.duration, d.seconds) AS duration
FROM episodes e
LEFT JOIN episode_overrides o ON o.episode_id = e.id
LEFT JOIN durations d         ON d.episode_id = e.id;
--> statement-breakpoint

-- One row per show: everything index.json needs except the Ukrainian-collation
-- sort, which SQLite cannot do and the exporter applies in JS.
--
-- A show is filed under the era of its most recent episode. The aggregate has
-- to land in a CTE first: SQLite rejects MAX() referenced from inside a
-- correlated subquery. The inner COALESCE reproduces the old eraFor()'s
-- fall-back-to-oldest-era branch for a year that matches no bucket; `secs` of 0
-- means "no durations known" and the exporter drops the key rather than
-- emitting a zero.
CREATE VIEW `v_show_index` AS
WITH agg AS (
  SELECT sh.id   AS id,
         sh.ord  AS ord,
         sh.slug AS slug,
         sh.name AS name,
         sh.host AS host,
         COUNT(e.id)                  AS n,
         COALESCE(SUM(e.duration), 0) AS secs,
         MIN(e.year)                  AS y0,
         MAX(e.year)                  AS y1
  FROM v_shows sh
  LEFT JOIN v_episodes e ON e.show_id = sh.id
  GROUP BY sh.id
)
SELECT a.id, a.ord, a.slug, a.name, a.host, a.n, a.secs, a.y0, a.y1,
       CASE WHEN a.y1 IS NULL THEN 'unknown' ELSE COALESCE(
         (SELECT id FROM eras
           WHERE year_from IS NOT NULL
             AND a.y1 BETWEEN year_from AND year_to
           ORDER BY ord LIMIT 1),
         (SELECT id FROM eras WHERE year_from IS NOT NULL ORDER BY ord DESC LIMIT 1)
       ) END AS era
FROM agg a;
--> statement-breakpoint

-- search.json. Episodes with neither a title nor a host have nothing to match
-- on and are skipped.
--
-- Row order is part of the output contract — the frontend scans linearly and
-- stops at 60 hits, so reordering silently changes which results a user sees.
-- The ordering keys are exposed as columns rather than baked into an ORDER BY
-- here: SQL does not guarantee a view's ORDER BY survives into the outer
-- query, so the exporter sorts on these explicitly.
CREATE VIEW `v_search` AS
SELECT sh.slug              AS slug,
       e.id                 AS id,
       e.title              AS title,
       COALESCE(e.host, '') AS host,
       COALESCE(e.date, '') AS date,
       sh.ord               AS show_ord,
       e.ord                AS ord
FROM v_episodes e
JOIN v_shows sh ON sh.id = e.show_id
WHERE e.title <> '' OR COALESCE(e.host, '') <> '';
--> statement-breakpoint

-- Era buckets, keyed on the year of a show's most recent episode. Labels are
-- prose, not derived from the bounds. `unknown` carries NULL bounds and is
-- matched by the CASE in v_show_index rather than by a range.
INSERT OR REPLACE INTO `eras` (`id`, `label`, `year_from`, `year_to`, `ord`) VALUES
  ('2020s',   '2020–2022', 2020, 9999, 0),
  ('2018',    '2018–2019', 2018, 2019, 1),
  ('2016',    '2016–2017', 2016, 2017, 2),
  ('2014',    '2014–2015',    0, 2015, 3),
  ('unknown', 'Без дати',  NULL, NULL, 4);
