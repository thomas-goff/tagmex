-- Salary gets its own category, flagged is_salary, so a salary credit can open a budget cycle while
-- other income (refunds, interest) stays in Income. For every user with the system Income category:
-- add Salary, re-point the seeded SALARY merchant rule at it, and move the transactions that rule
-- categorised. Manual and learned choices are left alone. New users get the same from defaults.ts.
insert into categories (user_id, name, kind, is_salary, sort_order)
select user_id, 'Salary', 'income', true, 12
from categories
where kind = 'income' and is_system
on conflict do nothing;
--> statement-breakpoint
-- Covers a user who already had a category called Salary.
update categories set is_salary = true where name = 'Salary' and kind = 'income';
--> statement-breakpoint
update category_rules r
set category_id = s.id, updated_at = now()
from categories s
where r.origin = 'seed'
  and r.match_type = 'token'
  and r.pattern = 'SALARY'
  and s.user_id = r.user_id
  and s.name = 'Salary'
  and s.is_salary
  and r.category_id in (select i.id from categories i where i.user_id = r.user_id and i.kind = 'income' and i.is_system);
--> statement-breakpoint
update transactions t
set category_id = r.category_id
from category_rules r
where t.rule_id = r.id
  and t.category_source = 'merchant_rule'
  and r.origin = 'seed'
  and r.pattern = 'SALARY'
  and t.category_id is distinct from r.category_id;
