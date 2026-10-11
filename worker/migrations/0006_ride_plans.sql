-- Display-only planned recommendation. History scoring never reads this column.
ALTER TABLE rides ADD COLUMN plan_json TEXT CHECK(plan_json IS NULL OR json_valid(plan_json));
