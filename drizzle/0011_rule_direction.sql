-- Learned rules match money out or money in only. Existing rows stay null (either direction), so
-- nothing changes until a rule is learned again. NULLS NOT DISTINCT keeps re-seeding idempotent.
CREATE TYPE "public"."rule_direction" AS ENUM('out', 'in');--> statement-breakpoint
ALTER TABLE "category_rules" DROP CONSTRAINT "category_rules_user_match_pattern_unique";--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "direction" "rule_direction";--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_match_pattern_direction_unique" UNIQUE NULLS NOT DISTINCT("user_id","match_type","pattern","direction");