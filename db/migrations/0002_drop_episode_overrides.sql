-- Drop episode_overrides. v_episodes joined it, so the dependent views
-- are dropped and rebuilt in the same migration.
DROP VIEW `v_search`;
--> statement-breakpoint
DROP VIEW `v_show_index`;
--> statement-breakpoint
DROP VIEW `v_episodes`;
--> statement-breakpoint
DROP TABLE `episode_overrides`;
--> statement-breakpoint

-- Same shape as 0001, minus the override layer. Duration comes only from
-- the ffprobe `durations` table.
CREATE VIEW `v_episodes` AS
SELECT e.id        AS id,
       e.show_id   AS show_id,
       e.ord       AS ord,
       e.path      AS path,
       e.raw_title AS raw_title,
       e.title     AS title,
       e.host      AS host,
       e.date      AS date,
       e.year      AS year,
       e.season    AS season,
       e.episode   AS episode,
       d.seconds   AS duration
FROM episodes e
LEFT JOIN durations d ON d.episode_id = e.id;
--> statement-breakpoint

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
