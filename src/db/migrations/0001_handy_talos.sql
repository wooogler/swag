CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_unique` ON `auth_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `auth_tokens_token_idx` ON `auth_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `auth_tokens_email_idx` ON `auth_tokens` (`email`);--> statement-breakpoint
CREATE TABLE `instructors` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instructors_email_unique` ON `instructors` (`email`);