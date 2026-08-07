-- Non-superuser role for application runtime connections.
-- Postgres RLS policies are always bypassed by superusers and table owners,
-- so the app must never connect as the `postgres` superuser used for migrations.
CREATE ROLE app_user LOGIN PASSWORD 'AppUser2026DbAccessBlanify';

GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
