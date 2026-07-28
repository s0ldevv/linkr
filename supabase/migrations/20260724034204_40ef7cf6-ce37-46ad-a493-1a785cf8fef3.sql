
-- Allow public read of NFT collections and mints for the public gallery
CREATE POLICY "Public read confirmed nft collections"
ON public.nft_collections FOR SELECT TO anon, authenticated
USING (mint_address IS NOT NULL);

CREATE POLICY "Public read confirmed nft mints"
ON public.nft_mints FOR SELECT TO anon, authenticated
USING (mint_address IS NOT NULL);

GRANT SELECT ON public.nft_collections TO anon;
GRANT SELECT ON public.nft_mints TO anon;
