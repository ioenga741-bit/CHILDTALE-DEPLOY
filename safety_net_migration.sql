-- ==========================================
-- SAFE MIGRATION: REGENERATION LOGIC
-- ==========================================

-- 1. Ensure `profiles` table exists and has `regeneration_credits`
-- This block is idempotent.
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  samples_used int default 0,
  regeneration_credits int default 0,
  updated_at timestamp with time zone
);

-- Enable RLS on profiles if not already
alter table public.profiles enable row level security;

-- Add column if it doesn't exist (safe migration)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'regeneration_credits') then
    alter table public.profiles add column regeneration_credits int default 0;
  end if;
end $$;

-- Policy: Users can read their own profile
drop policy if exists "Users can see own profile" on profiles;
create policy "Users can see own profile" on profiles for select using (auth.uid() = id);

-- Policy: Users can update their own profile (limited, but needed for some generic updates)
-- Strictly, we prefer RPCs for credits, but this allows basic access 
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);


-- 2. CONSUME CREDIT LOGIC (RPC)
-- Called when user clicks "Regenerate"
create or replace function consume_regeneration_credit(book_uuid uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  user_cred int;
begin
  -- Get current credits
  select regeneration_credits into user_cred
  from profiles
  where id = auth.uid();

  -- Check balance
  if user_cred > 0 then
    -- Deduct 1 credit
    update profiles
    set regeneration_credits = regeneration_credits - 1
    where id = auth.uid();

    -- Log this attempt or update book status if needed (Book update happens in frontend mostly)
    -- We could enforce book status here, but frontend does it.
    
    return true;
  else
    return false;
  end if;
end;
$$;


-- 3. REFUND CREDIT LOGIC (RPC)
-- Called if generation crashes/fails
create or replace function handle_generation_failure(book_uuid uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Refund the credit
  update profiles
  set regeneration_credits = regeneration_credits + 1
  where id = auth.uid();

  -- Mark book as failed (redundant safety)
  update books
  set status = 'failed'
  where id = book_uuid and user_id = auth.uid();
end;
$$;
