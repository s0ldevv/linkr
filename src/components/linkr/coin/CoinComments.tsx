import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { relativeTime } from "@/lib/linkr/format";
import { authSearchFor } from "@/lib/linkr/auth-return";

type CommentRow = {
  id: string;
  mint: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  author: {
    twitter_username: string | null;
    twitter_name: string | null;
    twitter_profile_image_url: string | null;
  } | null;
};

type CommentBaseRow = Omit<CommentRow, "author">;
type PublicProfileRow = NonNullable<CommentRow["author"]> & { user_id: string };
type RpcError = { message?: string };

const profileRpc = supabase as unknown as {
  rpc: (
    fn: "get_public_profiles",
    args: { _user_ids: string[] },
  ) => Promise<{ data: PublicProfileRow[] | null; error: RpcError | null }>;
};

type CommentNode = CommentRow & { children: CommentNode[] };

const MAX_LEN = 2000;

export function CoinComments({ mint, symbol }: { mint: string; symbol: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["coin-comments", mint, user?.id ?? "anon"] as const;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("coin_comments")
        .select("id, mint, user_id, parent_id, body, like_count, reply_count, created_at")
        .eq("mint", mint)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      // Fetch author display info via a security-definer RPC so unauthenticated
      // viewers (and users viewing others' comments) can see names/avatars.
      // Profiles RLS restricts direct SELECT to the owner.
      const authorMap = new Map<
        string,
        {
          twitter_username: string | null;
          twitter_name: string | null;
          twitter_profile_image_url: string | null;
        }
      >();
      const baseRows = (rows ?? []) as CommentBaseRow[];
      const userIds = Array.from(new Set(baseRows.map((r) => r.user_id)));
      if (userIds.length > 0) {
        const { data: authors, error: authorsErr } = await profileRpc.rpc("get_public_profiles", {
          _user_ids: userIds,
        });
        if (authorsErr) throw authorsErr;
        (authors ?? []).forEach((a) => {
          authorMap.set(a.user_id, {
            twitter_username: a.twitter_username ?? null,
            twitter_name: a.twitter_name ?? null,
            twitter_profile_image_url: a.twitter_profile_image_url ?? null,
          });
        });
      }

      const rowsWithAuthor: CommentRow[] = baseRows.map((r) => ({
        ...r,
        author: authorMap.get(r.user_id) ?? null,
      }));

      let likedIds = new Set<string>();
      if (user && rows && rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const { data: likes } = await supabase
          .from("coin_comment_likes")
          .select("comment_id")
          .eq("user_id", user.id)
          .in("comment_id", ids);
        likedIds = new Set((likes ?? []).map((l) => l.comment_id));
      }
      return { rows: rowsWithAuthor, likedIds };
    },
  });

  const tree = useMemo(() => buildTree(data?.rows ?? []), [data]);
  const totalCount = data?.rows.length ?? 0;

  return (
    <section className="cc-section" aria-label={`Comments on ${symbol}`}>
      <header className="cc-header">
        <div className="cc-header-title">
          <MessageCircle aria-hidden="true" size={18} />
          <h2>Discussion</h2>
          <span className="cc-count">{totalCount}</span>
        </div>
        <p className="cc-header-sub">Share your take on ${symbol}. Be kind.</p>
      </header>

      <Composer
        mint={mint}
        parentId={null}
        queryKey={queryKey}
        placeholder={`What's your take on $${symbol}?`}
      />

      <div className="cc-list">
        {isLoading && (
          <div className="cc-empty">
            <Loader2 className="cc-spin" size={16} /> Loading discussion…
          </div>
        )}
        {!isLoading && tree.length === 0 && (
          <div className="cc-empty">Be the first to leave a comment.</div>
        )}
        {tree.map((node) => (
          <CommentItem
            key={node.id}
            node={node}
            mint={mint}
            likedIds={data?.likedIds ?? new Set()}
            queryKey={queryKey}
            depth={0}
          />
        ))}
      </div>
    </section>
  );
}

function CommentItem({
  node,
  mint,
  likedIds,
  queryKey,
  depth,
}: {
  node: CommentNode;
  mint: string;
  likedIds: Set<string>;
  queryKey: readonly unknown[];
  depth: number;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showReply, setShowReply] = useState(false);
  const [pendingLike, setPendingLike] = useState(false);
  const liked = likedIds.has(node.id);
  const name = node.author?.twitter_name || node.author?.twitter_username || "Someone";
  const handle = node.author?.twitter_username ? `@${node.author.twitter_username}` : "";
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const profileUsername = node.author?.twitter_username ?? null;

  const toggleLike = async () => {
    if (!user) {
      navigate({
        to: "/auth",
        search: authSearchFor(window.location.pathname + window.location.search),
      });
      return;
    }
    if (pendingLike) return;
    setPendingLike(true);
    try {
      if (liked) {
        const { error } = await supabase
          .from("coin_comment_likes")
          .delete()
          .eq("comment_id", node.id)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("coin_comment_likes")
          .insert({ comment_id: node.id, user_id: user.id });
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error((err as Error).message || "Failed to update like");
    } finally {
      setPendingLike(false);
    }
  };

  return (
    <article className={`cc-item cc-depth-${Math.min(depth, 2)}`}>
      {profileUsername ? (
        <Link
          to="/u/$username"
          params={{ username: profileUsername }}
          className="cc-avatar cc-avatar-link"
          aria-label={`View ${name}'s profile`}
        >
          {node.author?.twitter_profile_image_url ? (
            <img src={node.author.twitter_profile_image_url} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </Link>
      ) : (
        <div className="cc-avatar" aria-hidden="true">
          {node.author?.twitter_profile_image_url ? (
            <img src={node.author.twitter_profile_image_url} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </div>
      )}
      <div className="cc-body">
        <header className="cc-meta">
          {profileUsername ? (
            <>
              <Link
                to="/u/$username"
                params={{ username: profileUsername }}
                className="cc-name cc-name-link"
              >
                {name}
              </Link>
              {handle && (
                <Link
                  to="/u/$username"
                  params={{ username: profileUsername }}
                  className="cc-handle cc-handle-link"
                >
                  {handle}
                </Link>
              )}
            </>
          ) : (
            <>
              <span className="cc-name">{name}</span>
              {handle && <span className="cc-handle">{handle}</span>}
            </>
          )}
          <span className="cc-dot" aria-hidden="true">
            ·
          </span>
          <time className="cc-time" dateTime={node.created_at}>
            {relativeTime(node.created_at)}
          </time>
        </header>
        <p className="cc-text">{node.body}</p>
        <div className="cc-actions">
          <button
            type="button"
            className={`cc-action cc-like${liked ? " is-liked" : ""}`}
            onClick={toggleLike}
            aria-pressed={liked}
          >
            <Heart aria-hidden="true" size={14} fill={liked ? "currentColor" : "none"} />
            <span>{node.like_count}</span>
          </button>
          {depth < 3 && (
            <button type="button" className="cc-action" onClick={() => setShowReply((v) => !v)}>
              <MessageCircle aria-hidden="true" size={14} />
              <span>Reply</span>
            </button>
          )}
        </div>

        {showReply && (
          <Composer
            mint={mint}
            parentId={node.id}
            queryKey={queryKey}
            placeholder={`Reply to ${name}`}
            onDone={() => setShowReply(false)}
            compact
          />
        )}

        {node.children.length > 0 && (
          <div className="cc-replies">
            {node.children.map((child) => (
              <CommentItem
                key={child.id}
                node={child}
                mint={mint}
                likedIds={likedIds}
                queryKey={queryKey}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Composer({
  mint,
  parentId,
  queryKey,
  placeholder,
  onDone,
  compact,
}: {
  mint: string;
  parentId: string | null;
  queryKey: readonly unknown[];
  placeholder: string;
  onDone?: () => void;
  compact?: boolean;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");

  const post = useMutation({
    mutationFn: async (body: string) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("coin_comments").insert({
        mint,
        user_id: user.id,
        parent_id: parentId,
        body,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setValue("");
      await queryClient.invalidateQueries({ queryKey });
      onDone?.();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to post comment"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate({
        to: "/auth",
        search: authSearchFor(window.location.pathname + window.location.search),
      });
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) return;
    post.mutate(trimmed.slice(0, MAX_LEN));
  };

  const disabled = post.isPending || loading;
  const remaining = MAX_LEN - value.length;
  const buttonLabel = !user ? "Sign in to post" : parentId ? "Reply" : "Post";

  return (
    <form className={`cc-composer${compact ? " cc-composer--compact" : ""}`} onSubmit={submit}>
      <textarea
        className="cc-textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_LEN}
        rows={compact ? 2 : 3}
        disabled={disabled}
      />
      <div className="cc-composer-footer">
        <span className={`cc-remaining${remaining < 120 ? " is-low" : ""}`}>{remaining}</span>
        <button
          type="submit"
          className="cc-submit"
          disabled={disabled || (!!user && !value.trim())}
        >
          {post.isPending ? (
            <Loader2 className="cc-spin" size={14} />
          ) : (
            <Send size={14} aria-hidden="true" />
          )}
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}

function buildTree(rows: CommentRow[]): CommentNode[] {
  const map = new Map<string, CommentNode>();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots: CommentNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // roots newest first (already sorted desc); children oldest first for reading flow
  map.forEach((n) => n.children.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  return roots;
}
