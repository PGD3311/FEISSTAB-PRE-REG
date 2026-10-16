-- Stand-ins for the Supabase pieces the pre-registration migrations use, so they apply
-- unchanged to a plain Postgres 17. Grants mirror a project where pre_registration is
-- exposed to the API with Supabase's defaults: the most permissive starting point.

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  aud text,
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- pg_cron: keep the jobs so tests can run their commands
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL
);
CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text) RETURNS bigint
LANGUAGE sql
AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_jobname, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$$;

CREATE SCHEMA pre_registration;
GRANT USAGE ON SCHEMA pre_registration TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pre_registration GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
