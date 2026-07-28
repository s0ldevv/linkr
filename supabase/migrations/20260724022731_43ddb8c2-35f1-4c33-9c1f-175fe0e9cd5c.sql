
CREATE TABLE IF NOT EXISTS public.nft_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL DEFAULT '',
  description text,
  image_url text NOT NULL,
  metadata_uri text,
  mint_address text UNIQUE,
  website_url text,
  twitter_url text,
  telegram_url text,
  source_tweet_id text,
  signature text,
  explorer_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nft_collections TO authenticated;
GRANT ALL ON public.nft_collections TO service_role;

ALTER TABLE public.nft_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own nft collections" ON public.nft_collections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS nft_collections_user_lower_name_idx
  ON public.nft_collections (user_id, lower(name));
CREATE INDEX IF NOT EXISTS nft_collections_user_lower_symbol_idx
  ON public.nft_collections (user_id, lower(symbol));
CREATE INDEX IF NOT EXISTS nft_collections_user_status_idx
  ON public.nft_collections (user_id, status);

CREATE TABLE IF NOT EXISTS public.nft_mints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  collection_id uuid NOT NULL REFERENCES public.nft_collections(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text NOT NULL,
  metadata_uri text,
  mint_address text UNIQUE,
  source_tweet_id text,
  image_source text CHECK (image_source IN ('user_media','parent_media','unknown')),
  signature text,
  explorer_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nft_mints TO authenticated;
GRANT ALL ON public.nft_mints TO service_role;

ALTER TABLE public.nft_mints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own nft mints" ON public.nft_mints
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS nft_mints_user_created_idx
  ON public.nft_mints (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nft_mints_collection_idx
  ON public.nft_mints (collection_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_nft_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_nft_collections_updated_at ON public.nft_collections;
CREATE TRIGGER trg_nft_collections_updated_at
  BEFORE UPDATE ON public.nft_collections
  FOR EACH ROW EXECUTE FUNCTION public.set_nft_updated_at();

DROP TRIGGER IF EXISTS trg_nft_mints_updated_at ON public.nft_mints;
CREATE TRIGGER trg_nft_mints_updated_at
  BEFORE UPDATE ON public.nft_mints
  FOR EACH ROW EXECUTE FUNCTION public.set_nft_updated_at();
