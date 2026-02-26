CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"tool_invocations" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "doi" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "source_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "search_queries" ALTER COLUMN "original_query" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;