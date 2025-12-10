ALTER TABLE `auth_tokens` ADD `type` text DEFAULT 'verification' NOT NULL;--> statement-breakpoint
ALTER TABLE `instructors` ADD `password` text;--> statement-breakpoint
ALTER TABLE `instructors` ADD `is_verified` integer DEFAULT false NOT NULL;