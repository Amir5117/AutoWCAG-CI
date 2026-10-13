ALTER TABLE "patches" ADD COLUMN "repoOwner" text;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "repoName" text;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "pullNumber" integer;