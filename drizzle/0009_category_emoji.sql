ALTER TABLE "categories" ADD COLUMN "emoji" text;--> statement-breakpoint
-- The default categories' emoji (defaults.ts gives new users the same). Matched by name; a renamed
-- or custom category stays null and shows 🏷️ until one is set.
update categories c
set emoji = d.emoji
from (values
  ('Groceries', '🛒'),
  ('Petrol', '⛽'),
  ('Rent / Bond', '🏠'),
  ('Utilities', '💡'),
  ('Eating Out', '🍔'),
  ('Entertainment', '🎬'),
  ('Medical', '💊'),
  ('Insurance', '🛡️'),
  ('Clothing', '👕'),
  ('Subscriptions', '📺'),
  ('Personal Care', '💈'),
  ('Transport', '🚌'),
  ('Salary', '💰')
) as d(name, emoji)
where c.name = d.name and c.emoji is null;
--> statement-breakpoint
-- System categories by kind, since they can be renamed.
update categories set emoji = '💵' where is_system and kind = 'income' and emoji is null;
--> statement-breakpoint
update categories set emoji = '🔁' where is_system and kind = 'transfer' and emoji is null;
