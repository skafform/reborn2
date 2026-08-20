CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_id_organization_id_key" UNIQUE("id","organization_id");
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_role_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "project_members_organization_id_idx" ON "project_members" USING btree ("organization_id");
