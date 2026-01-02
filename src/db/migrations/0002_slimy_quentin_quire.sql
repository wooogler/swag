ALTER TABLE "student_sessions" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" DROP COLUMN "web_search_enabled";