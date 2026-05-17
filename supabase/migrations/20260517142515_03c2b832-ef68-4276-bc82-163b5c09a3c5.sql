
-- Roles enum
create type public.app_role as enum ('user', 'operator', 'administrator');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- Security definer role check
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Auto-create profile + default 'user' role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: profiles
create policy "Users can view own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Administrators can view all profiles"
  on public.profiles for select to authenticated
  using (public.has_role(auth.uid(), 'administrator'));

create policy "Administrators can update any profile"
  on public.profiles for update to authenticated
  using (public.has_role(auth.uid(), 'administrator'));

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- RLS: user_roles
create policy "Users can view own roles"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

create policy "Administrators can view all roles"
  on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(), 'administrator'));

create policy "Administrators can insert roles"
  on public.user_roles for insert to authenticated
  with check (public.has_role(auth.uid(), 'administrator'));

create policy "Administrators can delete roles"
  on public.user_roles for delete to authenticated
  using (public.has_role(auth.uid(), 'administrator'));
