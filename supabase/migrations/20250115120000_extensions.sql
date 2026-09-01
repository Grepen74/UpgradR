-- Extensions required by the UpgradR schema.
--
-- gen_random_uuid() is built into Postgres 13+, so pgcrypto is not required
-- for primary keys. pgTAP powers the RLS/behavior test suite under
-- supabase/tests/database and is intentionally installed in every
-- environment (it adds only test helper functions, no attack surface).
create extension if not exists pgtap with schema extensions;
