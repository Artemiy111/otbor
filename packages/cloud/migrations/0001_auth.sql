-- Better Auth owns these tables in the hosted deployment. The local profile
-- keeps the same shape so `user_id` foreign keys have a single meaning: they
-- point at the auth user, never at an hh account.
create table if not exists "user" (
  id text primary key,
  name text,
  email text,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
