CREATE TABLE "pt_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pt_slots_guild_start_user_uq" UNIQUE("guild_id","starts_at","user_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_challenges" (
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_challenges_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_level_chk";--> statement-breakpoint
ALTER TABLE "staff_members" DROP CONSTRAINT "staff_members_level_chk";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pt_slots" ADD CONSTRAINT "pt_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_challenges" ADD CONSTRAINT "ticket_challenges_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_challenges" ADD CONSTRAINT "ticket_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pt_slots_guild_start_idx" ON "pt_slots" USING btree ("guild_id","starts_at");--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_level_chk" CHECK (level IN ('NONE', 'SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER'));--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_level_chk" CHECK (level IN ('NONE', 'SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER'));