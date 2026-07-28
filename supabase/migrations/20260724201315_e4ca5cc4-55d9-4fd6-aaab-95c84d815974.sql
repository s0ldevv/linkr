CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  twitter_username text,
  twitter_name text,
  twitter_profile_image_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.twitter_username, p.twitter_name, p.twitter_profile_image_url
  FROM public.profiles p
  WHERE p.user_id = ANY(_user_ids)
$$;

REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO anon, authenticated;