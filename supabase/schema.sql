create table if not exists public.tk_shared_plenaries (
  id uuid primary key default gen_random_uuid(),
  share_token uuid not null unique default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tk_shared_plenaries
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.tk_shared_plenaries enable row level security;

create or replace function public.create_shared_plenary(p_state jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_share_token uuid;
begin
  insert into public.tk_shared_plenaries (state, user_id)
  values (p_state, auth.uid())
  returning share_token into new_share_token;

  return new_share_token;
end;
$$;

create or replace function public.get_shared_plenary(p_share_token uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select state
  from public.tk_shared_plenaries
  where share_token = p_share_token;
$$;

create or replace function public.update_shared_plenary(p_share_token uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tk_shared_plenaries
  set state = p_state,
      updated_at = now()
  where share_token = p_share_token;

  if not found then
    raise exception 'Lien de plénière introuvable.';
  end if;
end;
$$;

create or replace function public.delete_shared_plenary(p_share_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tk_shared_plenaries
  where share_token = p_share_token;

  if not found then
    raise exception 'Lien de plénière introuvable.';
  end if;
end;
$$;

revoke all on table public.tk_shared_plenaries from anon, authenticated;
revoke all on function public.create_shared_plenary(jsonb) from public;
revoke all on function public.get_shared_plenary(uuid) from public;
revoke all on function public.update_shared_plenary(uuid, jsonb) from public;
revoke all on function public.delete_shared_plenary(uuid) from public;
grant execute on function public.create_shared_plenary(jsonb) to anon;
grant execute on function public.get_shared_plenary(uuid) to anon;
grant execute on function public.update_shared_plenary(uuid, jsonb) to anon;
grant execute on function public.delete_shared_plenary(uuid) to anon;
grant execute on function public.create_shared_plenary(jsonb) to authenticated;
grant execute on function public.get_shared_plenary(uuid) to authenticated;
grant execute on function public.update_shared_plenary(uuid, jsonb) to authenticated;
grant execute on function public.delete_shared_plenary(uuid) to authenticated;