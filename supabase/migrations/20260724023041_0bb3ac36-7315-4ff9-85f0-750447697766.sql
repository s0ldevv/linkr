
CREATE TABLE IF NOT EXISTS public.nft_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wallet_id UUID NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  website_url TEXT,
  twitter_url TEXT,
  telegram_url TEXT,
  mint_address TEXT UNIQUE,
  metadata_uri TEXT,
  signature TEXT,
  explorer_url TEXT,
  source_tweet_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nft_collections TO authenticated;
GRANT ALL ON public.nft_collections TO service_role;
ALTER TABLE public.nft_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own nft collections" ON public.nft_collections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS nft_collections_user_idx ON public.nft_collections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nft_collections_user_name_idx ON public.nft_collections(user_id, lower(name));

CREATE TABLE IF NOT EXISTS public.nft_mints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wallet_id UUID NOT NULL,
  collection_id UUID NOT NULL REFERENCES public.nft_collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_source TEXT,
  mint_address TEXT UNIQUE,
  metadata_uri TEXT,
  signature TEXT,
  explorer_url TEXT,
  source_tweet_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nft_mints TO authenticated;
GRANT ALL ON public.nft_mints TO service_role;
ALTER TABLE public.nft_mints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own nft mints" ON public.nft_mints
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS nft_mints_user_idx ON public.nft_mints(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nft_mints_collection_idx ON public.nft_mints(collection_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_nft_collections_updated_at ON public.nft_collections;
CREATE TRIGGER update_nft_collections_updated_at BEFORE UPDATE ON public.nft_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_nft_mints_updated_at ON public.nft_mints;
CREATE TRIGGER update_nft_mints_updated_at BEFORE UPDATE ON public.nft_mints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
