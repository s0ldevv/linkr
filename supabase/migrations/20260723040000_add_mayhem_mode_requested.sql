-- Add mayhem_mode_requested column to coin_launches table
-- This allows users to explicitly request mayhem mode for their launches
-- Migration: 20260723040000_add_mayhem_mode_requested.sql

-- Add the column with default false (normal mode by default)
ALTER TABLE public.coin_launches
  ADD COLUMN IF NOT EXISTS mayhem_mode_requested boolean DEFAULT false;

-- Add comment explaining the column
COMMENT ON COLUMN public.coin_launches.mayhem_mode_requested IS 
  'User explicitly requested mayhem mode for this launch. Defaults to false (normal mode).';

-- Add index for filtering launches by mayhem mode preference
CREATE INDEX IF NOT EXISTS coin_launches_mayhem_mode_requested_idx 
  ON public.coin_launches(mayhem_mode_requested) 
  WHERE mayhem_mode_requested = true;
