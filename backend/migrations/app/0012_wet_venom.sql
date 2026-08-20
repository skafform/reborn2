CREATE TYPE "public"."api_key_kind" AS ENUM('public', 'preview', 'secret');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"name" text NOT NULL,
	"token" text,
	"token_hash" text,
	"hint" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_token_unique" UNIQUE("token"),
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_keys_secret_is_hashed" CHECK (("api_keys"."kind" = 'secret' AND "api_keys"."token_hash" IS NOT NULL AND "api_keys"."token" IS NULL)
       OR ("api_keys"."kind" <> 'secret' AND "api_keys"."token" IS NOT NULL AND "api_keys"."token_hash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_environment_id_idx" ON "api_keys" USING btree ("environment_id");