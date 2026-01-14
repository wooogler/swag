ALTER TABLE "instructors" ADD COLUMN "role" text DEFAULT 'instructor' NOT NULL;
ALTER TABLE "student_sessions" ADD COLUMN "user_id" text;
