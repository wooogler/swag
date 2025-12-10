CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`deadline` integer NOT NULL,
	`share_token` text NOT NULL,
	`instructor_id` text,
	`custom_system_prompt` text,
	`include_instruction_in_prompt` integer DEFAULT false,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_share_token_unique` ON `assignments` (`share_token`);--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `student_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`timestamp` integer NOT NULL,
	`sequence_number` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `editor_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_data` text NOT NULL,
	`timestamp` integer NOT NULL,
	`sequence_number` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `student_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `student_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_name` text NOT NULL,
	`student_email` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_saved_at` integer,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
