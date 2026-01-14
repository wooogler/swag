ALTER TABLE "assignments" ADD COLUMN "allow_web_search" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "student_sessions" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "student_sessions" ADD COLUMN "last_login_at" timestamp;