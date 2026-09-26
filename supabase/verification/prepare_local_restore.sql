-- Only for the explicitly named disposable restore rehearsal database.
-- Bootstrap this database with the compatible local Supabase platform schema
-- first. Remove every application object before testing the staging backup.
begin;
do $$
begin
  if current_database() <> 'rally_restore_verify_20260921' then
    raise exception 'Refusing to clear schemas outside the disposable restore database';
  end if;
end;
$$;
drop schema if exists public cascade;
drop schema if exists private cascade;
drop schema if exists supabase_migrations cascade;
-- Restore these from staging's exact managed-schema snapshot. A local Auth
-- service version may be behind the hosted version even on identical Postgres.
drop schema if exists auth cascade;
drop schema if exists storage cascade;
create schema public authorization pg_database_owner;
commit;
