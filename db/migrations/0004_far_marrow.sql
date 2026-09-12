ALTER TABLE `episodes` ADD `description` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `image` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `description` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `site_url` text;--> statement-breakpoint

DROP VIEW `v_search`;--> statement-breakpoint
DROP VIEW `v_show_index`;--> statement-breakpoint
DROP VIEW `v_episodes`;--> statement-breakpoint
DROP VIEW `v_shows`;--> statement-breakpoint

CREATE VIEW `v_shows` AS
SELECT s.id                       AS id,
       s.ord                      AS ord,
       COALESCE(o.slug, s.slug)   AS slug,
       COALESCE(o.name, s.name)   AS name,
       COALESCE(o.host, s.host)   AS host,
       s.image                    AS image,
       s.description              AS description,
       s.site_url                 AS site_url
FROM shows s
LEFT JOIN show_overrides o ON o.show_id = s.id;--> statement-breakpoint

CREATE VIEW `v_episodes` AS
SELECT e.id          AS id,
       e.show_id     AS show_id,
       e.ord         AS ord,
       e.path        AS path,
       e.raw_title   AS raw_title,
       e.title       AS title,
       e.host        AS host,
       e.description AS description,
       e.date        AS date,
       e.year        AS year,
       e.season      AS season,
       e.episode     AS episode,
       e.duration    AS duration
FROM episodes e;--> statement-breakpoint

CREATE VIEW `v_show_index` AS
WITH agg AS (
  SELECT sh.id          AS id,
         sh.ord         AS ord,
         sh.slug        AS slug,
         sh.name        AS name,
         sh.host        AS host,
         sh.image       AS image,
         sh.description AS description,
         sh.site_url    AS site_url,
         COUNT(e.id)                  AS n,
         COALESCE(SUM(e.duration), 0) AS secs,
         MIN(e.year)                  AS y0,
         MAX(e.year)                  AS y1
  FROM v_shows sh
  LEFT JOIN v_episodes e ON e.show_id = sh.id
  GROUP BY sh.id
)
SELECT a.id, a.ord, a.slug, a.name, a.host, a.image, a.description, a.site_url,
       a.n, a.secs, a.y0, a.y1,
       CASE WHEN a.y1 IS NULL THEN 'unknown' ELSE COALESCE(
         (SELECT id FROM eras
           WHERE year_from IS NOT NULL
             AND a.y1 BETWEEN year_from AND year_to
           ORDER BY ord LIMIT 1),
         (SELECT id FROM eras WHERE year_from IS NOT NULL ORDER BY ord DESC LIMIT 1)
       ) END AS era
FROM agg a;--> statement-breakpoint

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