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

create table if not exists public.tk_presentation_sessions (
  id uuid primary key,
  project_id uuid not null references public.tk_shared_plenaries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tk_presentation_sessions enable row level security;

drop policy if exists "Owners can read their presentation sessions" on public.tk_presentation_sessions;
create policy "Owners can read their presentation sessions"
  on public.tk_presentation_sessions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Owners can update their presentation sessions" on public.tk_presentation_sessions;
create policy "Owners can update their presentation sessions"
  on public.tk_presentation_sessions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tk_presentation_sessions'
  ) then
    alter publication supabase_realtime add table public.tk_presentation_sessions;
  end if;
end;
$$;

create or replace function public.create_presentation_session(
  p_share_token uuid,
  p_session_id uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_row public.tk_shared_plenaries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise pour démarrer une session.';
  end if;

  select * into project_row
  from public.tk_shared_plenaries
  where share_token = p_share_token and user_id = auth.uid();

  if not found then
    raise exception 'Projet introuvable ou non autorisé.';
  end if;

  insert into public.tk_presentation_sessions (id, project_id, user_id, state)
  values (
    p_session_id,
    project_row.id,
    auth.uid(),
    jsonb_set(p_state, '{version}', '1'::jsonb, true)
  );

  return jsonb_build_object('id', p_session_id, 'state', jsonb_set(p_state, '{version}', '1'::jsonb, true), 'version', 1, 'status', 'active', 'project', project_row.state);
end;
$$;

create or replace function public.get_presentation_session(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', session.id,
    'state', session.state,
    'version', session.version,
    'status', session.status,
    'project', project.state
  )
  from public.tk_presentation_sessions session
  join public.tk_shared_plenaries project on project.id = session.project_id
  where session.id = p_session_id and session.user_id = auth.uid();
$$;

create or replace function public.update_presentation_session(
  p_session_id uuid,
  p_state jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_session public.tk_presentation_sessions%rowtype;
begin
  update public.tk_presentation_sessions
  set state = jsonb_set(p_state, '{version}', to_jsonb(p_expected_version + 1), true),
      version = version + 1,
      updated_at = now()
  where id = p_session_id
    and user_id = auth.uid()
    and version = p_expected_version
  returning * into updated_session;

  if not found then
    raise exception 'La session a été modifiée par une autre interface. Rechargez son état avant de réessayer.';
  end if;

  return jsonb_build_object('id', updated_session.id, 'state', updated_session.state, 'version', updated_session.version, 'status', updated_session.status);
end;
$$;

revoke all on table public.tk_presentation_sessions from anon, authenticated;
revoke all on function public.create_presentation_session(uuid, uuid, jsonb) from public;
revoke all on function public.get_presentation_session(uuid) from public;
revoke all on function public.update_presentation_session(uuid, jsonb, bigint) from public;
grant select on table public.tk_presentation_sessions to authenticated;
grant execute on function public.create_presentation_session(uuid, uuid, jsonb) to authenticated;
grant execute on function public.get_presentation_session(uuid) to authenticated;
grant execute on function public.update_presentation_session(uuid, jsonb, bigint) to authenticated;

create table if not exists public.tk_public_session_rooms (
  room_token text primary key check (room_token ~ '^[A-Za-z0-9_-]{43}$'),
  session_id uuid not null unique references public.tk_presentation_sessions(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.tk_public_session_rooms enable row level security;

create or replace function public.create_public_session_room(
  p_session_id uuid,
  p_room_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise pour créer un Room.';
  end if;

  if p_room_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Token de Room invalide.';
  end if;

  insert into public.tk_public_session_rooms (room_token, session_id, owner_user_id)
  select p_room_token, session.id, auth.uid()
  from public.tk_presentation_sessions session
  where session.id = p_session_id and session.user_id = auth.uid();

  if not found then
    raise exception 'Session introuvable ou non autorisée.';
  end if;

  return jsonb_build_object('roomToken', p_room_token, 'sessionId', p_session_id);
end;
$$;

create or replace function public.get_public_session_room(p_room_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', session.status,
    'isRunning', coalesce((session.state ->> 'isRunning')::boolean, false)
  )
  from public.tk_public_session_rooms room
  join public.tk_presentation_sessions session on session.id = room.session_id
  where room.room_token = p_room_token;
$$;

create or replace function public.get_owned_public_session_room(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('roomToken', room.room_token)
  from public.tk_public_session_rooms room
  where room.session_id = p_session_id and room.owner_user_id = auth.uid();
$$;

revoke all on table public.tk_public_session_rooms from anon, authenticated;
revoke all on function public.create_public_session_room(uuid, text) from public;
revoke all on function public.get_public_session_room(text) from public;
revoke all on function public.get_owned_public_session_room(uuid) from public;
grant execute on function public.create_public_session_room(uuid, text) to authenticated;
grant execute on function public.get_public_session_room(text) to anon, authenticated;
grant execute on function public.get_owned_public_session_room(uuid) to authenticated;

create table if not exists public.tk_session_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tk_presentation_sessions(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500 and text = btrim(text)),
  status text not null default 'pending' check (status in ('pending', 'answered', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.tk_session_questions enable row level security;

drop policy if exists "Owners can read their session questions" on public.tk_session_questions;
create policy "Owners can read their session questions"
  on public.tk_session_questions for select to authenticated
  using (
    exists (
      select 1 from public.tk_presentation_sessions session
      where session.id = session_id and session.user_id = auth.uid()
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tk_session_questions'
  ) then
    alter publication supabase_realtime add table public.tk_session_questions;
  end if;
end;
$$;

create or replace function public.create_public_session_question(
  p_room_token text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_question public.tk_session_questions%rowtype;
  clean_text text := btrim(coalesce(p_text, ''));
begin
  if p_room_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Token de Room invalide.';
  end if;
  if char_length(clean_text) not between 1 and 500 then
    raise exception 'La question doit contenir entre 1 et 500 caractères.';
  end if;

  insert into public.tk_session_questions (session_id, text)
  select room.session_id, clean_text
  from public.tk_public_session_rooms room
  join public.tk_presentation_sessions session on session.id = room.session_id
  where room.room_token = p_room_token and session.status = 'active'
  returning * into new_question;

  if not found then
    raise exception 'Room introuvable ou session terminée.';
  end if;

  return jsonb_build_object(
    'id', new_question.id,
    'text', new_question.text,
    'status', new_question.status,
    'created_at', new_question.created_at
  );
end;
$$;

create or replace function public.get_owned_session_questions(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', question.id,
    'text', question.text,
    'status', question.status,
    'created_at', question.created_at
  ) order by question.created_at desc), '[]'::jsonb)
  from public.tk_session_questions question
  join public.tk_presentation_sessions session on session.id = question.session_id
  where question.session_id = p_session_id and session.user_id = auth.uid();
$$;

create or replace function public.update_owned_session_question_status(
  p_question_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_question public.tk_session_questions%rowtype;
begin
  if p_status not in ('pending', 'answered', 'dismissed') then
    raise exception 'Statut de question invalide.';
  end if;

  update public.tk_session_questions question
  set status = p_status
  from public.tk_presentation_sessions session
  where question.id = p_question_id
    and session.id = question.session_id
    and session.user_id = auth.uid()
  returning question.* into updated_question;

  if not found then
    raise exception 'Question introuvable ou non autorisée.';
  end if;

  return jsonb_build_object(
    'id', updated_question.id,
    'text', updated_question.text,
    'status', updated_question.status,
    'created_at', updated_question.created_at
  );
end;
$$;

revoke all on table public.tk_session_questions from anon, authenticated;
grant select on table public.tk_session_questions to authenticated;
revoke all on function public.create_public_session_question(text, text) from public;
revoke all on function public.get_owned_session_questions(uuid) from public;
revoke all on function public.update_owned_session_question_status(uuid, text) from public;
grant execute on function public.create_public_session_question(text, text) to anon, authenticated;
grant execute on function public.get_owned_session_questions(uuid) to authenticated;
grant execute on function public.update_owned_session_question_status(uuid, text) to authenticated;

drop function if exists public.save_owned_session_quiz(uuid, text, text, jsonb, text);
drop function if exists public.get_owned_active_session_quiz(uuid, text);
drop function if exists public.get_owned_quiz_response_count(uuid);
drop function if exists public.submit_public_quiz_response(text, uuid, uuid, text);
drop table if exists public.tk_quiz_responses;
drop table if exists public.tk_session_quizzes;

create table public.tk_quiz_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tk_presentation_sessions(id) on delete cascade,
  quiz_id uuid not null,
  participant_id uuid not null,
  option_id text not null,
  created_at timestamptz not null default now(),
  unique (session_id, quiz_id, participant_id)
);

alter table public.tk_quiz_responses enable row level security;

create or replace function public.is_valid_project_quiz(p_quiz jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_quiz) = 'object'
    and p_quiz->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and char_length(btrim(coalesce(p_quiz->>'question', ''))) > 0
    and jsonb_typeof(p_quiz->'options') = 'array'
    and jsonb_array_length(case when jsonb_typeof(p_quiz->'options') = 'array' then p_quiz->'options' else '[]'::jsonb end) = 4
    and (select count(*) from jsonb_array_elements(case when jsonb_typeof(p_quiz->'options') = 'array' then p_quiz->'options' else '[]'::jsonb end) option where char_length(btrim(coalesce(option->>'label', ''))) > 0) between 2 and 4
    and (select count(*) = 4 and count(distinct option->>'id') = 4 and bool_and(option->>'id' in ('A', 'B', 'C', 'D')) from jsonb_array_elements(case when jsonb_typeof(p_quiz->'options') = 'array' then p_quiz->'options' else '[]'::jsonb end) option)
    and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_quiz->'options') = 'array' then p_quiz->'options' else '[]'::jsonb end) option where option->>'id' = p_quiz->>'correctOptionId' and char_length(btrim(coalesce(option->>'label', ''))) > 0);
$$;

create or replace function public.get_public_room_activity(p_room_token text, p_participant_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  with current_room as (
    select session.id as session_id, session.state, project.state as project_state
    from public.tk_public_session_rooms room
    join public.tk_presentation_sessions session on session.id = room.session_id
    join public.tk_shared_plenaries project on project.id = session.project_id
    where room.room_token = p_room_token and session.status = 'active'
  ), active_quiz as (
    select current_room.session_id, slot->'quiz' as quiz
    from current_room
    cross join lateral jsonb_array_elements(coalesce(current_room.project_state->'slots', '[]'::jsonb)) slot
    where slot->>'type' = 'quiz'
      and (current_room.state->>'currentSlide')::integer between (slot->>'startSlide')::integer and (slot->>'endSlide')::integer
      and public.is_valid_project_quiz(slot->'quiz')
  )
  select coalesce((
    select jsonb_build_object(
      'quiz', jsonb_build_object(
        'id', quiz->>'id',
        'question', quiz->>'question',
        'options', (select jsonb_agg(jsonb_build_object('id', option->>'id', 'label', option->>'label')) from jsonb_array_elements(quiz->'options') option where char_length(btrim(coalesce(option->>'label', ''))) > 0),
        'hasResponded', exists (select 1 from public.tk_quiz_responses response where response.session_id = active_quiz.session_id and response.quiz_id = (quiz->>'id')::uuid and response.participant_id = p_participant_id)
      )
    ) from active_quiz
  ), jsonb_build_object('quiz', null));
$$;

create or replace function public.submit_public_quiz_response(p_room_token text, p_participant_id uuid, p_option_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_room_token !~ '^[A-Za-z0-9_-]{43}$' or char_length(btrim(coalesce(p_option_id, ''))) = 0 then
    raise exception 'Quiz indisponible.';
  end if;

  insert into public.tk_quiz_responses (session_id, quiz_id, participant_id, option_id)
  select session.id, (slot->'quiz'->>'id')::uuid, p_participant_id, p_option_id
  from public.tk_public_session_rooms room
  join public.tk_presentation_sessions session on session.id = room.session_id
  join public.tk_shared_plenaries project on project.id = session.project_id
  cross join lateral jsonb_array_elements(coalesce(project.state->'slots', '[]'::jsonb)) slot
  where room.room_token = p_room_token
    and session.status = 'active'
    and slot->>'type' = 'quiz'
    and (session.state->>'currentSlide')::integer between (slot->>'startSlide')::integer and (slot->>'endSlide')::integer
    and public.is_valid_project_quiz(slot->'quiz')
    and exists (select 1 from jsonb_array_elements(slot->'quiz'->'options') option where option->>'id' = p_option_id and char_length(btrim(coalesce(option->>'label', ''))) > 0);

  if not found then
    raise exception 'Quiz indisponible.';
  end if;
end;
$$;

create or replace function public.get_owned_quiz_response_summary(p_session_id uuid, p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.tk_presentation_sessions session
    where session.id = p_session_id and session.user_id = auth.uid()
  ) then
    raise exception 'Session introuvable ou non autorisée.';
  end if;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'quizId', p_quiz_id,
    'responseCount', (select count(*) from public.tk_quiz_responses response where response.session_id = p_session_id and response.quiz_id = p_quiz_id)
  );
end;
$$;

revoke all on table public.tk_quiz_responses from anon, authenticated;
revoke all on function public.is_valid_project_quiz(jsonb) from public;
revoke all on function public.get_public_room_activity(text, uuid), public.submit_public_quiz_response(text, uuid, text), public.get_owned_quiz_response_summary(uuid, uuid) from public;
grant execute on function public.get_public_room_activity(text, uuid), public.submit_public_quiz_response(text, uuid, text) to anon, authenticated;
grant execute on function public.get_owned_quiz_response_summary(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';