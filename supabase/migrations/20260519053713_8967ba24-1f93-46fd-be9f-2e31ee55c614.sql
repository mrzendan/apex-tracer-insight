
ALTER TABLE public.invites
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uses_count integer NOT NULL DEFAULT 0;

-- Backfill uses_count for already-used legacy invites
UPDATE public.invites SET uses_count = 1 WHERE used_at IS NOT NULL AND uses_count = 0;
