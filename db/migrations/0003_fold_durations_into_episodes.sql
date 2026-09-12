-- Fold durations into episodes, then drop the table. Views that join
-- durations have to be rebuilt in the same migration.
DROP VIEW `v_search`;
--> statement-breakpoint
DROP VIEW `v_show_index`;
--> statement-breakpoint
DROP VIEW `v_episodes`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` integer NOT NULL,
	`ord` integer NOT NULL,
	`path` text NOT NULL,
	`raw_title` text NOT NULL,
	`title` text NOT NULL,
	`host` text,
	`date` text,
	`year` integer,
	`season` integer,
	`episode` integer,
	`duration` integer,
	`probed_at` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "episodes_date_iso" CHECK("__new_episodes"."date" IS NULL OR "__new_episodes"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "episodes_duration_positive" CHECK("__new_episodes"."duration" IS NULL OR "__new_episodes"."duration" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_episodes`("id", "show_id", "ord", "path", "raw_title", "title", "host", "date", "year", "season", "episode", "duration", "probed_at")
SELECT e."id", e."show_id", e."ord", e."path", e."raw_title", e."title", e."host", e."date", e."year", e."season", e."episode", d."seconds", d."probed_at"
FROM `episodes` e
LEFT JOIN `durations` d ON d."episode_id" = e."id";
--> statement-breakpoint
DROP TABLE `episodes`;
--> statement-breakpoint
ALTER TABLE `__new_episodes` RENAME TO `episodes`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_path_unique` ON `episodes` (`path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_show_ord` ON `episodes` (`show_id`,`ord`);
--> statement-breakpoint
DROP TABLE `durations`;
--> statement-breakpoint

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
       e.duration  AS duration
FROM episodes e;
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
