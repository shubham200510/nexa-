-- NEXPLAY v0.1 — Supabase schema and server-validated Tic-Tac-Toe.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 6),
  game text not null default 'tic_tac_toe' check (game = 'tic_tac_toe'),
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  board jsonb not null default '[null,null,null,null,null,null,null,null,null]'::jsonb,
  current_turn uuid references auth.users(id),
  winner uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_rooms_code_idx on public.game_rooms(code);
create index if not exists game_rooms_host_idx on public.game_rooms(host_id);
create index if not exists game_rooms_guest_idx on public.game_rooms(guest_id);

alter table public.profiles enable row level security;
alter table public.game_rooms enable row level security;

drop policy if exists "Profiles are visible to authenticated users" on public.profiles;
create policy "Profiles are visible to authenticated users" on public.profiles
  for select to authenticated using (true);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Room participants can read their rooms" on public.game_rooms;
create policy "Room participants can read their rooms" on public.game_rooms
  for select to authenticated using (auth.uid() = host_id or auth.uid() = guest_id);

create or replace function public.make_room_code()
returns text language plpgsql volatile as $$
declare v_code text;
begin
  loop
    v_code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 6));
    exit when not exists (select 1 from public.game_rooms where code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.create_room(p_game text default 'tic_tac_toe')
returns setof public.game_rooms
language plpgsql security definer set search_path = public
as $$
declare v_room public.game_rooms;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_game <> 'tic_tac_toe' then raise exception 'Game not available'; end if;
  insert into public.game_rooms(code, game, host_id, current_turn)
  values (public.make_room_code(), p_game, auth.uid(), auth.uid())
  returning * into v_room;
  return next v_room;
end;
$$;

create or replace function public.join_room(p_code text)
returns setof public.game_rooms
language plpgsql security definer set search_path = public
as $$
declare v_room public.game_rooms;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_room from public.game_rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.host_id = auth.uid() then return next v_room; return; end if;
  if v_room.status <> 'waiting' or v_room.guest_id is not null then raise exception 'Room is full or already started'; end if;
  update public.game_rooms set guest_id = auth.uid(), status = 'playing', updated_at = now()
  where id = v_room.id returning * into v_room;
  return next v_room;
end;
$$;

create or replace function public.play_ttt_move(p_room_id uuid, p_cell integer)
returns setof public.game_rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.game_rooms;
  v_board jsonb;
  v_mark text;
  v_winner text;
  v_i integer;
  v_lines integer[][] := array[
    array[0,1,2], array[3,4,5], array[6,7,8],
    array[0,3,6], array[1,4,7], array[2,5,8],
    array[0,4,8], array[2,4,6]
  ];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_cell < 0 or p_cell > 8 then raise exception 'Invalid cell'; end if;
  select * into v_room from public.game_rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'playing' then raise exception 'Match is not active'; end if;
  if auth.uid() not in (v_room.host_id, v_room.guest_id) then raise exception 'Not a room participant'; end if;
  if auth.uid() <> v_room.current_turn then raise exception 'It is not your turn'; end if;
  if v_room.board -> p_cell <> 'null'::jsonb then raise exception 'Cell already taken'; end if;

  v_mark := case when auth.uid() = v_room.host_id then 'X' else 'O' end;
  v_board := jsonb_set(v_room.board, array[p_cell::text], to_jsonb(v_mark));
  v_winner := null;
  for v_i in 1..8 loop
    if v_board -> v_lines[v_i][1] = to_jsonb(v_board ->> v_lines[v_i][2])
       and v_board ->> v_lines[v_i][1] = v_mark
       and v_board ->> v_lines[v_i][3] = v_mark then
      v_winner := v_mark;
      exit;
    end if;
  end loop;

  update public.game_rooms
  set board = v_board,
      winner = case when v_winner = 'X' then host_id when v_winner = 'O' then guest_id else null end,
      status = case when v_winner is not null or not (v_board @> '[null]'::jsonb) then 'finished' else 'playing' end,
      current_turn = case when auth.uid() = host_id then guest_id else host_id end,
      updated_at = now()
  where id = p_room_id returning * into v_room;

  return next v_room;
end;
$$;

revoke all on function public.create_room(text) from public;
revoke all on function public.join_room(text) from public;
revoke all on function public.play_ttt_move(uuid, integer) from public;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.play_ttt_move(uuid, integer) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_username text;
begin
  v_username := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));
  v_username := regexp_replace(lower(v_username), '[^a-z0-9_]', '', 'g');
  if char_length(v_username) < 3 then v_username := 'player' || substr(new.id::text, 1, 8); end if;
  insert into public.profiles(id, username)
  values (new.id, left(v_username, 24))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.game_rooms;
exception when duplicate_object then null;
when undefined_object then null;
end $$;