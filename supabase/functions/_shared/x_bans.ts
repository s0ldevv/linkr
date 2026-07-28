// deno-lint-ignore-file no-explicit-any

export interface XIdentity {
  twitterId: string | null;
  username: string | null;
  name: string | null;
  profileImageUrl: string | null;
}

export interface ActiveXBan {
  id: string;
  x_user_id: string;
  username_at_ban: string | null;
  display_name_at_ban: string | null;
  profile_image_url: string | null;
  reason: string | null;
  banned_at: string;
  updated_at: string;
}

export function normalizeXHandle(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function configuredLinkrAdminXUserId(
  readEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string {
  const value = String(readEnv("LINKR_ADMIN_X_USER_ID") ?? "").trim();
  if (!/^\d+$/.test(value)) throw new Error("LINKR_ADMIN_X_USER_ID is not configured correctly");
  return value;
}

async function getProfileIdentity(admin: any, userId: string): Promise<XIdentity> {
  const { data, error } = await admin
    .from("profiles")
    .select("twitter_id,twitter_username,twitter_name,twitter_profile_image_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  return {
    twitterId: normalizeNullableText(data?.twitter_id),
    username: normalizeXHandle(data?.twitter_username) || null,
    name: normalizeNullableText(data?.twitter_name),
    profileImageUrl: normalizeNullableText(data?.twitter_profile_image_url),
  };
}

async function getAuthMetadataIdentity(admin: any, userId: string): Promise<XIdentity> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;

  const user = data?.user;
  const meta = user?.user_metadata ?? {};
  const identity =
    user?.identities?.find((item: any) => item.provider === "twitter" || item.provider === "x") ??
    user?.identities?.[0];
  const identityData = identity?.identity_data ?? {};
  const email = String(user?.email ?? "");
  const emailMatch = /^x-([^@]+)@x\.linkr\.cash$/i.exec(email);

  return {
    twitterId: normalizeNullableText(
      meta.provider_id ??
        identityData.provider_id ??
        meta.sub ??
        identityData.sub ??
        identity?.id ??
        emailMatch?.[1] ??
        null,
    ),
    username:
      normalizeXHandle(
        meta.user_name ??
          meta.preferred_username ??
          identityData.user_name ??
          identityData.preferred_username ??
          null,
      ) || null,
    name: normalizeNullableText(
      meta.full_name ?? meta.name ?? identityData.full_name ?? identityData.name ?? null,
    ),
    profileImageUrl: normalizeNullableText(
      meta.avatar_url ?? meta.picture ?? identityData.avatar_url ?? identityData.picture ?? null,
    ),
  };
}

export async function getAuthUserXIdentity(admin: any, userId: string): Promise<XIdentity> {
  const profile = await getProfileIdentity(admin, userId);
  const auth = await getAuthMetadataIdentity(admin, userId);

  return {
    twitterId: profile.twitterId ?? auth.twitterId,
    username: profile.username ?? auth.username,
    name: profile.name ?? auth.name,
    profileImageUrl: profile.profileImageUrl ?? auth.profileImageUrl,
  };
}

export async function getActiveXBan(
  admin: any,
  twitterId: string | null | undefined,
): Promise<ActiveXBan | null> {
  const id = normalizeNullableText(twitterId);
  if (!id) return null;

  const { data, error } = await admin
    .from("banned_x_users")
    .select(
      "id,x_user_id,username_at_ban,display_name_at_ban,profile_image_url,reason,banned_at,updated_at",
    )
    .eq("x_user_id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getActiveBanForAuthUser(
  admin: any,
  userId: string,
): Promise<{ identity: XIdentity; ban: ActiveXBan | null }> {
  const identity = await getAuthUserXIdentity(admin, userId);
  const ban = await getActiveXBan(admin, identity.twitterId);
  return { identity, ban };
}

export async function isLinkrAdminUser(
  admin: any,
  userId: string,
): Promise<{ isAdmin: boolean; identity: XIdentity; reason?: string }> {
  const identity = await getAuthUserXIdentity(admin, userId);
  const configuredAdminId = configuredLinkrAdminXUserId();
  if (identity.twitterId === configuredAdminId) {
    return { isAdmin: true, identity };
  }

  return {
    isAdmin: false,
    identity,
    reason: "not_linkr_x_user_id",
  };
}
