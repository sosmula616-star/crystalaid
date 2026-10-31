CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_range_chk" CHECK ("absences"."ends_on" >= "absences"."starts_on"),
	CONSTRAINT "absences_status_chk" CHECK (status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"reason" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculated_amount" bigint NOT NULL,
	"adjusted_amount" bigint,
	"adjust_reason" text,
	"adjusted_by" uuid,
	CONSTRAINT "payroll_lines_period_user_uq" UNIQUE("period_id","user_id"),
	CONSTRAINT "payroll_lines_amounts_nonneg" CHECK ("payroll_lines"."calculated_amount" >= 0 AND ("payroll_lines"."adjusted_amount" IS NULL OR "payroll_lines"."adjusted_amount" >= 0))
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "payroll_periods_guild_week_uq" UNIQUE("guild_id","week_start"),
	CONSTRAINT "payroll_periods_status_chk" CHECK (status IN ('draft', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "presence_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"guild_id" text NOT NULL,
	"level" text NOT NULL,
	"permission" text NOT NULL,
	"amount_limit" bigint,
	CONSTRAINT "role_permissions_guild_id_level_permission_pk" PRIMARY KEY("guild_id","level","permission"),
	CONSTRAINT "role_permissions_level_chk" CHECK (level IN ('NONE', 'SUPPORT', 'CURATOR', 'ADMIN')),
	CONSTRAINT "role_permissions_limit_nonneg" CHECK ("role_permissions"."amount_limit" IS NULL OR "role_permissions"."amount_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"excluded_seconds" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prompted_at" timestamp with time zone,
	"edited_by" uuid,
	CONSTRAINT "shifts_end_reason_chk" CHECK ("shifts"."end_reason" IS NULL OR "shifts"."end_reason" IN ('manual', 'auto_closed', 'edited'))
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" bigint NOT NULL,
	"stock" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_price_nonneg" CHECK ("shop_items"."price" >= 0),
	CONSTRAINT "shop_items_stock_nonneg" CHECK ("shop_items"."stock" IS NULL OR "shop_items"."stock" >= 0),
	CONSTRAINT "shop_items_kind_chk" CHECK (kind IN ('role', 'theme', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_orders_status_chk" CHECK (status IN ('pending', 'fulfilled', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "staff_daily" (
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"online_seconds" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"shift_seconds" integer DEFAULT 0 NOT NULL,
	"tickets_claimed" integer DEFAULT 0 NOT NULL,
	"tickets_closed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "staff_daily_guild_id_user_id_day_pk" PRIMARY KEY("guild_id","user_id","day")
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text DEFAULT 'SUPPORT' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"position" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_balance" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "staff_members_guild_user_uq" UNIQUE("guild_id","user_id"),
	CONSTRAINT "staff_members_balance_nonneg" CHECK ("staff_members"."token_balance" >= 0),
	CONSTRAINT "staff_members_level_chk" CHECK (level IN ('NONE', 'SUPPORT', 'CURATOR', 'ADMIN')),
	CONSTRAINT "staff_members_status_chk" CHECK (status IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_type_chk" CHECK (type IN ('created', 'claimed', 'transferred', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"discord_message_id" text,
	"author_discord_id" text NOT NULL,
	"author_user_id" uuid,
	"is_staff" boolean DEFAULT false NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"channel_id" text,
	"claimed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"result" text,
	"rating" smallint,
	"rated_at" timestamp with time zone,
	CONSTRAINT "tickets_status_chk" CHECK (status IN ('open', 'claimed', 'closed')),
	CONSTRAINT "tickets_rating_chk" CHECK ("tickets"."rating" IS NULL OR "tickets"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "token_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "token_ledger_type_chk" CHECK (type IN ('payroll', 'grant', 'deduct', 'purchase', 'refund')),
	CONSTRAINT "token_ledger_amount_nonzero" CHECK ("token_ledger"."amount" <> 0),
	CONSTRAINT "token_ledger_balance_nonneg" CHECK ("token_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_events" ADD CONSTRAINT "career_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_events" ADD CONSTRAINT "career_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_sessions" ADD CONSTRAINT "presence_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_daily" ADD CONSTRAINT "staff_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_guild_user_starts_idx" ON "absences" USING btree ("guild_id","user_id","starts_on");--> statement-breakpoint
CREATE INDEX "audit_log_guild_created_idx" ON "audit_log" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "career_events_guild_user_idx" ON "career_events" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presence_sessions_one_open_uq" ON "presence_sessions" USING btree ("guild_id","user_id") WHERE "presence_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_uq" ON "shifts" USING btree ("guild_id","user_id") WHERE "shifts"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shifts_guild_user_started_idx" ON "shifts" USING btree ("guild_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "shop_items_guild_active_idx" ON "shop_items" USING btree ("guild_id","active");--> statement-breakpoint
CREATE INDEX "shop_orders_guild_status_idx" ON "shop_orders" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "staff_notes_guild_user_idx" ON "staff_notes" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_created_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_created_idx" ON "ticket_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_open_per_category_uq" ON "tickets" USING btree ("guild_id","requester_id","category") WHERE "tickets"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "tickets_guild_status_idx" ON "tickets" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "token_ledger_guild_user_created_idx" ON "token_ledger" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_one_open_uq" ON "voice_sessions" USING btree ("guild_id","user_id") WHERE "voice_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "warnings_guild_user_idx" ON "warnings" USING btree ("guild_id","user_id");