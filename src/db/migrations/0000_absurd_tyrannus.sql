CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"deadline" timestamp NOT NULL,
	"share_token" text NOT NULL,
	"instructor_id" text,
	"custom_system_prompt" text,
	"include_instruction_in_prompt" boolean DEFAULT false,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "assignments_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"type" text DEFAULT 'verification' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL,
	"sequence_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editor_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"timestamp" timestamp NOT NULL,
	"sequence_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text,
	"name" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "instructors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "student_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_name" text NOT NULL,
	"student_email" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_saved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_events" ADD CONSTRAINT "editor_events_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_token_idx" ON "auth_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_tokens_email_idx" ON "auth_tokens" USING btree ("email");