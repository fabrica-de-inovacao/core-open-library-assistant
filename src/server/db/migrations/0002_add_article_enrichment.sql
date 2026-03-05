ALTER TABLE "articles" ADD COLUMN "abstract" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "keywords" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "citation_count" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "publisher" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "is_open_access" boolean;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "metadata_source" varchar(50) DEFAULT 'scraper';