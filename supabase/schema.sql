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

create table if not exists public.tk_session_quizzes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tk_presentation_sessions(id) on delete cascade,
  slot_id text not null,
  question text not null check (char_length(btrim(question)) > 0),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_option_id text,
  created_at timestamptz not null default now(),
  unique (session_id, slot_id)
);

create table if not exists public.tk_quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.tk_session_quizzes(id) on delete cascade,
  session_id uuid not null references public.tk_presentation_sessions(id) on delete cascade,
  participant_id uuid not null,
  option_id text not null,
  created_at timestamptz not null default now(),
  unique (quiz_id, participant_id)
);

alter table public.tk_session_quizzes enable row level security;
alter table public.tk_quiz_responses enable row level security;

drop policy if exists "Owners can read quiz responses" on public.tk_quiz_responses;
create policy "Owners can read quiz responses" on public.tk_quiz_responses for select to authenticated
using (exists (
  select 1 from public.tk_session_quizzes quiz
  join public.tk_presentation_sessions session on session.id = quiz.session_id
  where quiz.id = quiz_id and session.user_id = auth.uid()
));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tk_quiz_responses') then
    alter publication supabase_realtime add table public.tk_quiz_responses;
  end if;
end; $$;

create or replace function public.save_owned_session_quiz(p_session_id uuid, p_slot_id text, p_question text, p_options jsonb, p_correct_option_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.tk_session_quizzes%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.tk_presentation_sessions where id = p_session_id and user_id = auth.uid()) then raise exception 'Session introuvable ou non autorisée.'; end if;
  if char_length(btrim(coalesce(p_question, ''))) = 0 or coalesce(jsonb_typeof(p_options), '') <> 'array' or jsonb_array_length(p_options) not between 2 and 4 then raise exception 'Quiz invalide.'; end if;
  insert into public.tk_session_quizzes (session_id, slot_id, question, options, correct_option_id)
  values (p_session_id, p_slot_id, btrim(p_question), p_options, p_correct_option_id)
  on conflict (session_id, slot_id) do update set question = excluded.question, options = excluded.options, correct_option_id = excluded.correct_option_id
  returning * into saved;
  return jsonb_build_object('id', saved.id, 'question', saved.question, 'options', saved.options, 'correctOptionId', saved.correct_option_id);
end; $$;

create or replace function public.get_owned_active_session_quiz(p_session_id uuid, p_slot_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id', quiz.id, 'question', quiz.question, 'options', quiz.options, 'correctOptionId', quiz.correct_option_id)
  from public.tk_session_quizzes quiz join public.tk_presentation_sessions session on session.id = quiz.session_id
  where quiz.session_id = p_session_id and quiz.slot_id = p_slot_id and session.user_id = auth.uid();
$$;

create or replace function public.get_owned_quiz_response_count(p_quiz_id uuid)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.tk_quiz_responses response join public.tk_session_quizzes quiz on quiz.id = response.quiz_id
  join public.tk_presentation_sessions session on session.id = quiz.session_id where response.quiz_id = p_quiz_id and session.user_id = auth.uid();
$$;

create or replace function public.get_public_room_activity(p_room_token text, p_participant_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  with current_room as (
    select session.id as session_id, session.state, project.state as project_state from public.tk_public_session_rooms room
    join public.tk_presentation_sessions session on session.id = room.session_id join public.tk_shared_plenaries project on project.id = session.project_id
    where room.room_token = p_room_token and session.status = 'active'
  ), active_slot as (
    select current_room.session_id, slot->>'id' as slot_id from current_room, jsonb_array_elements(current_room.project_state->'slots') slot
    where (slot->>'type') = 'quiz' and (current_room.state->>'currentSlide')::integer between (slot->>'startSlide')::integer and (slot->>'endSlide')::integer
  )
  select jsonb_build_object('quiz', case when quiz.id is null then null else jsonb_build_object('id', quiz.id, 'question', quiz.question, 'options', quiz.options, 'hasResponded', exists(select 1 from public.tk_quiz_responses response where response.quiz_id = quiz.id and response.participant_id = p_participant_id)) end)
  from active_slot slot left join public.tk_session_quizzes quiz on quiz.session_id = slot.session_id and quiz.slot_id = slot.slot_id;
$$;

create or replace function public.submit_public_quiz_response(p_room_token text, p_participant_id uuid, p_quiz_id uuid, p_option_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tk_quiz_responses (quiz_id, session_id, participant_id, option_id)
  select quiz.id, session.id, p_participant_id, p_option_id from public.tk_public_session_rooms room
  join public.tk_presentation_sessions session on session.id = room.session_id join public.tk_shared_plenaries project on project.id = session.project_id
  join public.tk_session_quizzes quiz on quiz.id = p_quiz_id and quiz.session_id = session.id
  where room.room_token = p_room_token and session.status = 'active' and exists (
    select 1 from jsonb_array_elements(project.state->'slots') slot where slot->>'id' = quiz.slot_id and slot->>'type' = 'quiz'
    and (session.state->>'currentSlide')::integer between (slot->>'startSlide')::integer and (slot->>'endSlide')::integer
  ) and exists (select 1 from jsonb_array_elements(quiz.options) option where option->>'id' = p_option_id);
  if not found then raise exception 'Quiz indisponible.'; end if;
end; $$;

revoke all on table public.tk_session_quizzes, public.tk_quiz_responses from anon, authenticated;
grant select on table public.tk_quiz_responses to authenticated;
revoke all on function public.save_owned_session_quiz(uuid, text, text, jsonb, text), public.get_owned_active_session_quiz(uuid, text), public.get_owned_quiz_response_count(uuid), public.get_public_room_activity(text, uuid), public.submit_public_quiz_response(text, uuid, uuid, text) from public;
grant execute on function public.save_owned_session_quiz(uuid, text, text, jsonb, text), public.get_owned_active_session_quiz(uuid, text), public.get_owned_quiz_response_count(uuid) to authenticated;
grant execute on function public.get_public_room_activity(text, uuid), public.submit_public_quiz_response(text, uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';