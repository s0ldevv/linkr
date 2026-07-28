export type ProfileTwitterInfo = {
  id: string | null;
  username: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  url: string | null;
  verified: boolean;
  protected: boolean;
  createdAt: string | null;
  followers: number | null;
  following: number | null;
  tweetCount: number | null;
  listedCount: number | null;
  source: "live" | "cached" | "stored";
};

export type ProfileIdentity = {
  userId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  joinedLinkrAt: string | null;
};

export type ProfileWallet = {
  address?: string | null;
  chainId?: number | null;
  explorerUrl?: string | null;
  ethUsdPrice?: number | null;
  publicKey: string;
  ethBalance: number | null;
  usdValue: number | null;
};

export type ProfileSolWallet = {
  publicKey: string;
  address?: string | null;
  explorerUrl?: string | null;
  solBalance: number | null;
  solUsdPrice: number | null;
  usdValue: number | null;
};

export type ProfileComment = {
  id: string;
  target?: "coin" | "nft_collection";
  subjectId?: string;
  mint: string | null;
  chain: string | null;
  body: string;
  likeCount: number;
  replyCount: number;
  isReply: boolean;
  createdAt: string;
  coinName: string | null;
  coinSymbol: string | null;
  coinImageUrl: string | null;
  subjectName?: string | null;
  subjectSymbol?: string | null;
  subjectImageUrl?: string | null;
};

export type ProfilePost = {
  id: string;
  tweetId: string;
  text: string;
  url: string | null;
  status: string;
  hasMedia: boolean;
  mediaUrl: string | null;
  createdAt: string;
  intent: string | null;
};

export type ProfileLaunch = {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  imageUrl: string | null;
  mint: string | null;
  tokenAddress?: string | null;
  status: string;
  chain?: string | null;
  launchPlatform?: string | null;
  devBuyEth: number | null;
  devBuySol?: number | null;
  devBuyUsd: number | null;
  createdAt: string;
};

export type ProfileTrade = {
  id: string;
  action: string | null;
  inputMint: string | null;
  outputMint: string | null;
  amountOriginal: number | null;
  amountOriginalUnit: string | null;
  amountEth: number | null;
  amountUsd: number | null;
  txHash: string | null;
  explorerUrl?: string | null;
  status: string | null;
  createdAt: string;
};

export type ProfileInquiry = {
  id: string;
  intent: string | null;
  status: string | null;
  tweetId: string | null;
  text: string | null;
  createdAt: string;
};

export type ProfileStats = {
  tradesTotal: number;
  trades30d: number;
  volumeUsdTotal: number | null;
  volumeUsd30d: number | null;
  launchesTotal: number;
  postsTotal: number;
  agentRunsTotal: number;
  inquiriesTotal: number;
  pendingActions: number;
  firstSeenAt: string | null;
  lastActivityAt: string | null;
};

export type UserProfileData = {
  username: string;
  isLinkrUser: boolean;
  profile: ProfileIdentity | null;
  twitter: ProfileTwitterInfo | null;
  wallet: ProfileWallet | null;
  solWallet: ProfileSolWallet | null;
  posts: ProfilePost[];
  launches: ProfileLaunch[];
  trades: ProfileTrade[];
  inquiries: ProfileInquiry[];
  comments: ProfileComment[];
  stats: ProfileStats | null;
};

export async function fetchUserProfileData(username: string): Promise<UserProfileData> {
  const normalized = username.trim().replace(/^@/, "");
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke<UserProfileData>(
    `user-profile-data?username=${encodeURIComponent(normalized)}`,
    { method: "GET" },
  );

  if (error) throw new Error(error.message || "Profile data is unavailable right now.");
  if (!data) throw new Error("Profile data is unavailable right now.");
  return data;
}
