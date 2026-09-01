-- RLS policies invoke private helpers in the app schema for both browser and
-- MCP-authenticated requests. EXECUTE alone is insufficient without schema
-- USAGE, so ordinary authenticated reads and writes would otherwise fail.
grant usage on schema app to authenticated;
