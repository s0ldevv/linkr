
-- Coin comments and likes
CREATE TABLE public.coin_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mint text NOT NULL,
  chain text NOT NULL DEFAULT 'solana',
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.coin_comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  like_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coin_comments_user_id_fkey_profile FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX coin_comments_mint_created_idx ON public.coin_comments (mint, created_at DESC);
CREATE INDEX coin_comments_parent_idx ON public.coin_comments (parent_id);
CREATE INDEX coin_comments_user_idx ON public.coin_comments (user_id);

GRANT SELECT ON public.coin_comments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.coin_comments TO authenticated;
GRANT ALL ON public.coin_comments TO service_role;

ALTER TABLE public.coin_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coin_comments_public_read" ON public.coin_comments
  FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);

CREATE POLICY "coin_comments_insert_own" ON public.coin_comments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "coin_comments_update_own" ON public.coin_comments
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "coin_comments_delete_own" ON public.coin_comments
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Likes
CREATE TABLE public.coin_comment_likes (
  comment_id uuid NOT NULL REFERENCES public.coin_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX coin_comment_likes_user_idx ON public.coin_comment_likes (user_id);

GRANT SELECT ON public.coin_comment_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.coin_comment_likes TO authenticated;
GRANT ALL ON public.coin_comment_likes TO service_role;

ALTER TABLE public.coin_comment_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coin_comment_likes_public_read" ON public.coin_comment_likes
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "coin_comment_likes_insert_own" ON public.coin_comment_likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "coin_comment_likes_delete_own" ON public.coin_comment_likes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Maintain updated_at
CREATE OR REPLACE FUNCTION public.coin_comments_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER coin_comments_touch_updated_at
  BEFORE UPDATE ON public.coin_comments
  FOR EACH ROW EXECUTE FUNCTION public.coin_comments_touch_updated_at();

-- Maintain like_count
CREATE OR REPLACE FUNCTION public.coin_comment_likes_maintain_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.coin_comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.coin_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER coin_comment_likes_maintain_count_ins
  AFTER INSERT ON public.coin_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.coin_comment_likes_maintain_count();
CREATE TRIGGER coin_comment_likes_maintain_count_del
  AFTER DELETE ON public.coin_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.coin_comment_likes_maintain_count();

-- Maintain reply_count
CREATE OR REPLACE FUNCTION public.coin_comments_maintain_reply_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
    UPDATE public.coin_comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_id IS NOT NULL THEN
    UPDATE public.coin_comments SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = OLD.parent_id;
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER coin_comments_maintain_reply_count
  AFTER INSERT OR DELETE ON public.coin_comments
  FOR EACH ROW EXECUTE FUNCTION public.coin_comments_maintain_reply_count();
