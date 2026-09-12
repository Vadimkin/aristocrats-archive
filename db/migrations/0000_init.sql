CREATE TABLE `durations` (
	`episode_id` text PRIMARY KEY NOT NULL,
	`seconds` integer NOT NULL,
	`probed_at` text,
	CONSTRAINT "durations_positive" CHECK("durations"."seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE `episode_overrides` (
	`episode_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`host` text,
	`date` text,
	`year` integer,
	`season` integer,
	`episode` integer,
	`duration` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `episodes` (
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
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "episodes_date_iso" CHECK("episodes"."date" IS NULL OR "episodes"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_path_unique` ON `episodes` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_show_ord` ON `episodes` (`show_id`,`ord`);--> statement-breakpoint
CREATE TABLE `eras` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`year_from` integer,
	`year_to` integer,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `show_overrides` (
	`show_id` integer PRIMARY KEY NOT NULL,
	`slug` text,
	`name` text,
	`host` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY NOT NULL,
	`ord` integer NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`source_name` text NOT NULL,
	`host` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_ord_unique` ON `shows` (`ord`);--> statement-breakpoint
CREATE UNIQUE INDEX `shows_slug_unique` ON `shows` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `shows_source_name_unique` ON `shows` (`source_name`);