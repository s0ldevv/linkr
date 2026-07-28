import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Archive,
  Bot,
  Check,
  Circle,
  Clock3,
  Copy,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, shortAddress } from "@/lib/linkr/format";

export const Route = createFileRoute("/_authenticated/app/terminal")({
  head: () => ({ meta: [{ title: "Terminal - Linkr" }] }),
  component: TerminalPage,
});

type Conversation = {
  id: string;
  title: string | null;
  status: string;
  summary: string | null;
  last_message_preview: string | null;
  last_message_role: string | null;
  last_message_at: string | null;
  pending_action_count: number | null;
  updated_at: string;
};

type TerminalMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts: MessagePart[];
  status: string;
  created_at: string;
  client_message_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

const MAX_TERMINAL_ATTACHMENTS = 4;

type MessagePart = {
  type: string;
  text?: string;
  title?: string;
  label?: string;
  status?: string;
  pending_action?: PendingAction;
  pending_action_id?: string;
  confirmation_phrase?: string;
  summary?: string;
  result?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  holdings?: Array<Record<string, unknown>>;
  wallets?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type PendingAction = {
  id: string;
  action_type: string;
  status: string;
  summary: string;
  confirmation_phrase: string;
  expires_at: string;
  action_payload: Record<string, unknown>;
  created_at: string;
};

type StreamMessage = {
  id: string;
  role: "assistant";
  content: string;
  parts: MessagePart[];
  status: string;
  created_at: string;
  conversation_id: string;
};

type ActiveTurnOrder = {
  assistantMessageId: string | null;
  clientMessageId: string;
  localAssistantId: string;
  localUserId: string;
  userMessageId: string | null;
};

type TerminalChatAttachment = {
  kind: "image";
  source_url: string;
  storage_path?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  byte_length?: number | null;
};

function TerminalPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [streaming, setStreaming] = useState<StreamMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingLocalUser, setPendingLocalUser] = useState<TerminalMessage | null>(null);
  const [activeTurnOrder, setActiveTurnOrder] = useState<ActiveTurnOrder | null>(null);
  const [attachments, setAttachments] = useState<TerminalChatAttachment[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamingRef = useRef<StreamMessage | null>(null);
  const lastScrolledConversationRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);

  const conversationsQuery = useQuery({
    queryKey: ["terminal-conversations", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const data = await apiJson<{ conversations: Conversation[] }>("/api/terminal/conversations");
      return data.conversations;
    },
  });

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
  const filteredConversations = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((item) =>
      [item.title, item.last_message_preview, item.summary]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [conversations, search]);

  useEffect(() => {
    if (selectedConversationId || conversations.length === 0) return;
    setSelectedConversationId(conversations[0].id);
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        attachmentMenuRef.current &&
        !attachmentMenuRef.current.contains(target)
      ) {
        setIsAttachmentMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsAttachmentMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

  const messagesQuery = useQuery({
    queryKey: ["terminal-messages", user?.id, selectedConversationId],
    enabled: Boolean(user?.id && selectedConversationId),
    queryFn: async () => {
      const data = await apiJson<{ messages: TerminalMessage[] }>(
        `/api/terminal/messages?conversation_id=${encodeURIComponent(selectedConversationId!)}`,
      );
      return data.messages;
    },
  });

  const pendingQuery = useQuery({
    queryKey: ["terminal-pending-actions", user?.id, selectedConversationId],
    enabled: Boolean(user?.id && selectedConversationId),
    queryFn: async () => {
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (
              column: string,
              value: string,
            ) => {
              eq: (
                column: string,
                value: string,
              ) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => {
                  limit: (
                    count: number,
                  ) => Promise<{ data: PendingAction[] | null; error: Error | null }>;
                };
              };
            };
          };
        };
      };
      const { data, error } = await client
        .from("linkr_pending_actions")
        .select("*")
        .eq("terminal_conversation_id", selectedConversationId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user?.id || !selectedConversationId) return;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidation = (includePending: boolean) => {
      if (invalidateTimer) clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["terminal-messages", user.id, selectedConversationId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["terminal-conversations", user.id],
        });
        if (includePending) {
          void queryClient.invalidateQueries({
            queryKey: ["terminal-pending-actions", user.id, selectedConversationId],
          });
        }
      }, 75);
    };
    const invalidateMessages = () => scheduleInvalidation(false);
    const invalidateActions = () => scheduleInvalidation(true);
    const channel = supabase
      .channel("terminal-" + selectedConversationId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "linkr_terminal_messages",
          filter: "conversation_id=eq." + selectedConversationId,
        },
        invalidateMessages,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "linkr_pending_actions",
          filter: "terminal_conversation_id=eq." + selectedConversationId,
        },
        invalidateActions,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "linkr_action_receipts",
          filter: "terminal_conversation_id=eq." + selectedConversationId,
        },
        invalidateActions,
      )
      .subscribe();
    return () => {
      if (invalidateTimer) clearTimeout(invalidateTimer);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, selectedConversationId, user?.id]);

  const visibleMessages = useMemo(() => {
    const base = messagesQuery.data ?? [];
    const visibleServerMessages = base.filter((message) => {
      if (streaming && message.role === "assistant" && message.id === streaming.id) return false;
      if (message.role === "assistant" && message.status === "typing" && !message.content)
        return false;
      return true;
    });
    const serverPendingUser =
      pendingLocalUser && activeTurnOrder
        ? visibleServerMessages.find((msg) =>
            isSameUserTurnMessage(msg, pendingLocalUser, activeTurnOrder),
          )
        : null;
    const out: Array<TerminalMessage | StreamMessage> = visibleServerMessages;
    if (pendingLocalUser && !serverPendingUser) out.push(pendingLocalUser);
    if (streaming && shouldRenderStreamingMessage(streaming)) out.push(streaming);

    const typingMessage = createActiveTypingMessage({
      activeTurn: activeTurnOrder,
      messages: out,
      pendingLocalUser,
      sending,
      streaming,
    });
    if (typingMessage) out.push(typingMessage);

    return out.sort((a, b) => compareTerminalMessages(a, b, activeTurnOrder));
  }, [activeTurnOrder, messagesQuery.data, pendingLocalUser, sending, streaming]);

  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1] ?? null;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const conversationChanged = lastScrolledConversationRef.current !== selectedConversationId;
    lastScrolledConversationRef.current = selectedConversationId;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: conversationChanged ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    lastVisibleMessage?.content,
    lastVisibleMessage?.id,
    lastVisibleMessage?.status,
    messagesQuery.isLoading,
    selectedConversationId,
    visibleMessages.length,
  ]);

  async function createConversation() {
    const data = await apiJson<{ conversation: Conversation }>("/api/terminal/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "New conversation" }),
    });
    await queryClient.invalidateQueries({ queryKey: ["terminal-conversations", user?.id] });
    setSelectedConversationId(data.conversation.id);
  }

  async function patchConversation(
    conversationId: string,
    action: "archive" | "delete" | "rename",
  ) {
    const title = action === "rename" ? window.prompt("Conversation title")?.trim() : undefined;
    if (action === "rename" && !title) return;
    await apiJson("/api/terminal/conversations", {
      method: "PATCH",
      body: JSON.stringify({ conversation_id: conversationId, action, title }),
    });
    await queryClient.invalidateQueries({ queryKey: ["terminal-conversations", user?.id] });
    if (action === "delete" && selectedConversationId === conversationId)
      setSelectedConversationId(null);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    const outgoingAttachments = attachments.slice(0, MAX_TERMINAL_ATTACHMENTS);
    const hasAttachmentContent = outgoingAttachments.length > 0;
    if ((!message && !hasAttachmentContent) || sending) return;
    setAttachments([]);
    const clientMessageId = crypto.randomUUID();
    const localUserId = "local-" + clientMessageId;
    const localAssistantId = "streaming-" + clientMessageId;
    const localConversationId = selectedConversationId ?? "new";
    const submittedAt = new Date();
    const assistantAt = new Date(submittedAt.getTime() + 1);
    let liveConversationId = selectedConversationId;
    let latestAssistantMessage: StreamMessage | null = null;
    setDraft("");
    setSending(true);
    setActiveTurnOrder({
      assistantMessageId: null,
      clientMessageId,
      localAssistantId,
      localUserId,
      userMessageId: null,
    });
    setPendingLocalUser({
      id: localUserId,
      conversation_id: localConversationId,
      role: "user",
      content: message,
      parts: [],
      status: "completed",
      created_at: submittedAt.toISOString(),
      client_message_id: clientMessageId,
      metadata: hasAttachmentContent ? { attachments: outgoingAttachments } : null,
    });
    commitStreaming({
      id: localAssistantId,
      conversation_id: localConversationId,
      role: "assistant",
      content: "",
      parts: [],
      status: "typing",
      created_at: assistantAt.toISOString(),
    });

    try {
      await streamTerminalChat(
        {
          conversation_id: selectedConversationId,
          client_message_id: clientMessageId,
          message,
          attachments: outgoingAttachments,
          client_context: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            route: "/app/terminal",
            selected_chain: "all",
          },
        },
        {
          ack: (payload) => {
            const conversationId = String(payload.conversation_id ?? "");
            if (conversationId) {
              liveConversationId = conversationId;
              const userMessageId = String(payload.user_message_id ?? "");
              const assistantMessageId = String(payload.assistant_message_id ?? "");
              setSelectedConversationId(conversationId);
              setActiveTurnOrder((current) =>
                current?.clientMessageId === clientMessageId
                  ? {
                      ...current,
                      assistantMessageId: assistantMessageId || current.assistantMessageId,
                      userMessageId: userMessageId || current.userMessageId,
                    }
                  : current,
              );
              setPendingLocalUser((current) =>
                current
                  ? {
                      ...current,
                      id: userMessageId || current.id,
                      conversation_id: conversationId,
                    }
                  : current,
              );
              updateLiveStreaming((current) =>
                current
                  ? {
                      ...current,
                      conversation_id: conversationId,
                      id: assistantMessageId || current.id,
                    }
                  : current,
              );
            }
          },
          delta: (payload) => {
            updateLiveStreaming((current) =>
              current
                ? {
                    ...current,
                    content: String(
                      payload.content ?? current.content + String(payload.delta ?? ""),
                    ),
                  }
                : current,
            );
          },
          message_update: (payload) => {
            const next = updateStreamingMessage(streamingRef.current, payload, liveConversationId);
            if (!next) return;
            latestAssistantMessage = next;
            upsertCachedMessage(next);
            commitStreaming(next);
          },
          action_required: () => {
            void queryClient.invalidateQueries({
              queryKey: ["terminal-pending-actions", user?.id, liveConversationId],
            });
          },
          complete: async () => {
            if (latestAssistantMessage) upsertCachedMessage(latestAssistantMessage);
            await queryClient.invalidateQueries({ queryKey: ["terminal-conversations", user?.id] });
            await queryClient.invalidateQueries({
              queryKey: ["terminal-messages", user?.id, liveConversationId],
            });
            await queryClient.invalidateQueries({
              queryKey: ["terminal-pending-actions", user?.id, liveConversationId],
            });
            setPendingLocalUser((current) =>
              current?.client_message_id === clientMessageId ? null : current,
            );
            commitStreaming(null);
            setSending(false);
          },
          error: (payload) => {
            const text = String(payload.message ?? "Linkr hit an error");
            toast.error(text);
            updateLiveStreaming((current) =>
              current ? { ...current, content: text, status: "failed" } : current,
            );
          },
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reach Linkr");
      updateLiveStreaming((current) =>
        current
          ? { ...current, content: "Linkr could not complete this turn.", status: "failed" }
          : current,
      );
    } finally {
      setSending(false);
    }

    function upsertCachedMessage(message: StreamMessage) {
      if (!user?.id || !message.conversation_id || message.conversation_id === "new") return;
      queryClient.setQueryData<TerminalMessage[]>(
        ["terminal-messages", user.id, message.conversation_id],
        (current) => upsertTerminalMessage(current ?? [], message),
      );
    }

    function commitStreaming(message: StreamMessage | null) {
      streamingRef.current = message;
      setStreaming(message);
    }

    function updateLiveStreaming(updater: (current: StreamMessage | null) => StreamMessage | null) {
      const next = updater(streamingRef.current);
      commitStreaming(next);
    }
  }

  async function confirmAction(pendingActionId: string, action: "confirm" | "cancel") {
    try {
      await apiJson("/api/terminal/action", {
        method: "POST",
        body: JSON.stringify({ pending_action_id: pendingActionId, action }),
      });
      toast.success(action === "confirm" ? "Action submitted" : "Action cancelled");
      await queryClient.invalidateQueries({
        queryKey: ["terminal-messages", user?.id, selectedConversationId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["terminal-pending-actions", user?.id, selectedConversationId],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  function openImagePicker() {
    setIsAttachmentMenuOpen(false);
    fileInputRef.current?.click();
  }

  async function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;
    const remainingSlots = Math.max(0, MAX_TERMINAL_ATTACHMENTS - attachments.length);
    if (!remainingSlots) {
      toast.error(`Attach up to ${MAX_TERMINAL_ATTACHMENTS} images per message.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const selectedFiles = selected.slice(0, remainingSlots);
    if (selectedFiles.length < selected.length) {
      toast.warning(
        `Only ${remainingSlots} more image slot${remainingSlots === 1 ? "" : "s"} available.`,
      );
    }
    setIsUploadingImage(true);
    try {
      const uploaded = await Promise.all(selectedFiles.map(uploadTerminalImage));
      setAttachments((current) => [...current, ...uploaded].slice(0, MAX_TERMINAL_ATTACHMENTS));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload image");
    } finally {
      setIsUploadingImage(false);
      setIsAttachmentMenuOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  const selectedConversation =
    conversations.find((item) => item.id === selectedConversationId) ?? null;
  const pendingActions = pendingQuery.data ?? [];

  return (
    <div className="app-dashboard-page terminal-page">
      <header className="app-live-hero app-dashboard-hero terminal-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Linkr Terminal</p>
          <h1>Chat with Linkr.</h1>
          <p>
            Private app chat for wallet context, portfolio questions, token research, X posts,
            launches, trades, transfers, liquidity, schedules, and confirmations.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Terminal connection state">
          <span />
          {sending ? "thinking" : "live"}
        </div>
      </header>

      <div className="terminal-shell">
        <aside
          className="sm-card app-dashboard-card terminal-conversations"
          aria-label="Conversations"
        >
          <div className="terminal-panel-head">
            <strong>Conversations</strong>
            <button type="button" aria-label="New conversation" onClick={createConversation}>
              <MessageSquarePlus aria-hidden="true" size={17} />
            </button>
          </div>
          <label className="terminal-search">
            <Search aria-hidden="true" size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
            />
          </label>
          <div className="terminal-conversation-list">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className="terminal-conversation-row"
                data-active={conversation.id === selectedConversationId}
                onClick={() => setSelectedConversationId(conversation.id)}
              >
                <span>
                  <strong>{conversation.title ?? "Conversation"}</strong>
                  <small>{conversation.last_message_preview ?? "No messages yet"}</small>
                </span>
                <em>
                  {conversation.pending_action_count ? `${conversation.pending_action_count}` : ""}
                </em>
              </button>
            ))}
            {filteredConversations.length === 0 && (
              <div className="terminal-empty">No conversations.</div>
            )}
          </div>
        </aside>

        <main className="sm-card app-dashboard-card terminal-chat" aria-label="Linkr chat">
          <div className="terminal-chat-head">
            <div>
              <p className="app-live-kicker">Authenticated chat</p>
              <h2>{selectedConversation?.title ?? "New terminal"}</h2>
            </div>
            <div className="terminal-head-actions">
              {selectedConversation && (
                <>
                  <button
                    type="button"
                    aria-label="Rename conversation"
                    onClick={() => patchConversation(selectedConversation.id, "rename")}
                  >
                    <Copy aria-hidden="true" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Archive conversation"
                    onClick={() => patchConversation(selectedConversation.id, "archive")}
                  >
                    <Archive aria-hidden="true" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={() => patchConversation(selectedConversation.id, "delete")}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="terminal-messages" ref={scrollRef}>
            {messagesQuery.isLoading && <TypingBubble label="Loading conversation" />}
            {!messagesQuery.isLoading && visibleMessages.length === 0 && (
              <div className="terminal-welcome">
                <Bot aria-hidden="true" size={28} />
                <strong>Linkr is ready.</strong>
                <p>
                  Ask about your portfolio, paste an X post, research a token, or prepare an action.
                </p>
              </div>
            )}
            {visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                pendingActions={pendingActions}
                onAction={confirmAction}
              />
            ))}
          </div>

          <form className="terminal-composer" onSubmit={sendMessage}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              multiple
              className="terminal-composer-file-input"
              onChange={handleAttachmentSelection}
              disabled={sending}
            />
            {attachments.length > 0 && (
              <div className="terminal-composer-attachments">
                {attachments.map((attachment, index) => (
                  <div
                    key={`${attachment.source_url}-${index}`}
                    className="terminal-composer-attachment"
                  >
                    <img src={attachment.source_url} alt="Uploaded image attachment" />
                    <button
                      type="button"
                      className="terminal-composer-attachment-remove"
                      onClick={() => removeAttachment(index)}
                      aria-label={`Remove attachment ${index + 1}`}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="terminal-composer-attach-menu-wrap" ref={attachmentMenuRef}>
              <button
                type="button"
                className="terminal-composer-upload"
                onClick={() => setIsAttachmentMenuOpen((open) => !open)}
                disabled={sending || isUploadingImage}
                aria-label="Open image attachment menu"
                aria-haspopup="menu"
                aria-expanded={isAttachmentMenuOpen}
                aria-controls="terminal-composer-attachment-menu"
              >
                {isUploadingImage ? (
                  <Loader2 aria-hidden="true" size={18} className="terminal-spin" />
                ) : (
                  <span className="terminal-composer-upload-plus">+</span>
                )}
              </button>
              {isAttachmentMenuOpen && (
                <div
                  id="terminal-composer-attachment-menu"
                  className="terminal-composer-attach-menu"
                  role="menu"
                >
                  <button
                    type="button"
                    className="terminal-composer-attach-menu-item"
                    role="menuitem"
                    onClick={openImagePicker}
                    disabled={attachments.length >= MAX_TERMINAL_ATTACHMENTS}
                    aria-label="Upload image"
                  >
                    Upload image
                  </button>
                </div>
              )}
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask Linkr anything..."
              rows={1}
            />
            <button
              type="submit"
              className="terminal-composer-send"
              disabled={sending || isUploadingImage || (!draft.trim() && attachments.length === 0)}
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 aria-hidden="true" size={18} className="terminal-spin" />
              ) : (
                <Send aria-hidden="true" size={19} strokeWidth={2.4} />
              )}
            </button>
          </form>
        </main>

        <aside className="terminal-context">
          <section className="sm-card app-dashboard-card">
            <div className="terminal-panel-head">
              <strong>Pending</strong>
              <Clock3 aria-hidden="true" size={16} />
            </div>
            {pendingActions.length === 0 ? (
              <div className="terminal-empty">Clear.</div>
            ) : (
              pendingActions.map((action) => (
                <PendingActionCard
                  key={action.id}
                  action={action}
                  onAction={confirmAction}
                  compact
                />
              ))
            )}
          </section>
          <section className="sm-card app-dashboard-card">
            <div className="terminal-panel-head">
              <strong>Prompts</strong>
              <Sparkles aria-hidden="true" size={16} />
            </div>
            <div className="terminal-prompt-list">
              {[
                "Show my portfolio",
                "What did I launch last?",
                "Research this token",
                "Show pending actions",
                "What can you do?",
              ].map((prompt) => (
                <button key={prompt} type="button" onClick={() => setDraft(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  pendingActions,
  onAction,
}: {
  message: TerminalMessage;
  pendingActions: PendingAction[];
  onAction: (id: string, action: "confirm" | "cancel") => void;
}) {
  const isUser = message.role === "user";
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const messageAttachments = getMessageAttachments(message);
  return (
    <article className="terminal-message" data-role={message.role} data-status={message.status}>
      <div className="terminal-message-avatar">
        {isUser ? <Circle aria-hidden="true" size={12} /> : <Bot aria-hidden="true" size={16} />}
      </div>
      <div className="terminal-message-body">
        <div className="terminal-message-meta">
          <strong>{isUser ? "You" : "Linkr"}</strong>
          <span>{formatTime(message.created_at)}</span>
          {message.status === "typing" && <em>typing</em>}
        </div>
        {message.content && <p>{message.content}</p>}
        {messageAttachments.length > 0 && (
          <div className="terminal-message-attachments">
            {messageAttachments.map((attachment, index) => (
              <a
                key={`${attachment.source_url}-${index}`}
                href={attachment.source_url}
                target="_blank"
                rel="noreferrer"
                className="terminal-message-attachment"
              >
                <img src={attachment.source_url} alt="Attached image" />
              </a>
            ))}
          </div>
        )}
        {message.status === "typing" && !message.content && (
          <TypingBubble label="Linkr is typing" inline />
        )}
        {parts.map((part, index) => (
          <MessagePartView
            key={`${message.id}-${index}`}
            part={part}
            pendingActions={pendingActions}
            onAction={onAction}
          />
        ))}
      </div>
    </article>
  );
}

function shouldRenderStreamingMessage(message: StreamMessage | null): boolean {
  if (!message) return false;
  if (message.status === "typing") return false;
  return Boolean(
    message.status === "failed" ||
    message.content.trim() ||
    (Array.isArray(message.parts) && message.parts.length > 0),
  );
}

function createActiveTypingMessage({
  activeTurn,
  messages,
  pendingLocalUser,
  sending,
  streaming,
}: {
  activeTurn: ActiveTurnOrder | null;
  messages: Array<TerminalMessage | StreamMessage>;
  pendingLocalUser: TerminalMessage | null;
  sending: boolean;
  streaming: StreamMessage | null;
}): StreamMessage | null {
  if (!sending || !activeTurn || shouldRenderStreamingMessage(streaming)) return null;
  const anchor =
    (pendingLocalUser && isSameUserTurnMessage(pendingLocalUser, pendingLocalUser, activeTurn)
      ? pendingLocalUser
      : null) ??
    messages.find(
      (message) => message.role === "user" && activeTurnMessageOrder(message, activeTurn) === 0,
    );
  if (!anchor) return null;
  return {
    id: "typing-" + activeTurn.clientMessageId,
    conversation_id: anchor.conversation_id,
    role: "assistant",
    content: "",
    parts: [],
    status: "typing",
    created_at: new Date(timestampForMessage(anchor) + 1).toISOString(),
  };
}

function isSameUserTurnMessage(
  message: TerminalMessage | StreamMessage,
  pendingUser: TerminalMessage,
  activeTurn: ActiveTurnOrder,
): boolean {
  if (message.role !== "user") return false;
  if (message.id === pendingUser.id) return true;
  if (message.id === activeTurn.localUserId || message.id === activeTurn.userMessageId) return true;
  if (
    "client_message_id" in message &&
    message.client_message_id &&
    message.client_message_id === activeTurn.clientMessageId
  ) {
    return true;
  }
  return (
    message.content === pendingUser.content &&
    Math.abs(timestampForMessage(message) - timestampForMessage(pendingUser)) < 10000
  );
}

function updateStreamingMessage(
  current: StreamMessage | null,
  payload: Record<string, unknown>,
  conversationId: string | null,
): StreamMessage | null {
  if (!current) return current;
  return {
    ...current,
    id: String(payload.message_id ?? current.id),
    conversation_id: conversationId ?? current.conversation_id,
    content: String(payload.content ?? current.content),
    parts: Array.isArray(payload.parts) ? (payload.parts as MessagePart[]) : current.parts,
    status: String(payload.status ?? "completed"),
  };
}

function upsertTerminalMessage(
  messages: TerminalMessage[],
  message: TerminalMessage,
): TerminalMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...message } : item));
}

function compareTerminalMessages(
  a: TerminalMessage | StreamMessage,
  b: TerminalMessage | StreamMessage,
  activeTurn: ActiveTurnOrder | null,
): number {
  const activeOrder = compareActiveTurnMessages(a, b, activeTurn);
  if (activeOrder !== 0) return activeOrder;

  const createdDelta = timestampForMessage(a) - timestampForMessage(b);
  if (createdDelta !== 0) return createdDelta;

  const roleDelta = roleOrder(a.role) - roleOrder(b.role);
  if (roleDelta !== 0) return roleDelta;

  return a.id.localeCompare(b.id);
}

function compareActiveTurnMessages(
  a: TerminalMessage | StreamMessage,
  b: TerminalMessage | StreamMessage,
  activeTurn: ActiveTurnOrder | null,
): number {
  if (!activeTurn) return 0;
  const aOrder = activeTurnMessageOrder(a, activeTurn);
  const bOrder = activeTurnMessageOrder(b, activeTurn);
  if (aOrder === bOrder) return 0;
  if (aOrder === null) return 0;
  if (bOrder === null) return 0;
  return aOrder - bOrder;
}

function activeTurnMessageOrder(
  message: TerminalMessage | StreamMessage,
  activeTurn: ActiveTurnOrder,
): number | null {
  if (
    message.id === activeTurn.localUserId ||
    message.id === activeTurn.userMessageId ||
    ("client_message_id" in message && message.client_message_id === activeTurn.clientMessageId)
  ) {
    return 0;
  }
  if (
    message.id === activeTurn.localAssistantId ||
    message.id === activeTurn.assistantMessageId ||
    message.id === "typing-" + activeTurn.clientMessageId
  ) {
    return 1;
  }
  return null;
}

function timestampForMessage(message: TerminalMessage | StreamMessage): number {
  const timestamp = new Date(message.created_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function roleOrder(role: TerminalMessage["role"]): number {
  if (role === "user") return 0;
  if (role === "assistant") return 1;
  if (role === "tool") return 2;
  return 3;
}

function MessagePartView({
  part,
  pendingActions,
  onAction,
}: {
  part: MessagePart;
  pendingActions: PendingAction[];
  onAction: (id: string, action: "confirm" | "cancel") => void;
}) {
  if (part.type === "confirmation_card") {
    const action =
      part.pending_action ?? pendingActions.find((item) => item.id === part.pending_action_id);
    if (!action) return null;
    return <PendingActionCard action={action} onAction={onAction} />;
  }
  if (part.type === "portfolio_snapshot") {
    const holdings = Array.isArray(part.holdings) ? part.holdings : [];
    return (
      <div className="terminal-part terminal-part-grid">
        {holdings.slice(0, 6).map((holding, index) => (
          <span key={index}>
            <b>
              {String(
                holding.symbol ?? shortAddress(String(holding.token_address ?? holding.mint ?? "")),
              )}
            </b>
            <small>{formatAmount(holding.amount)}</small>
          </span>
        ))}
      </div>
    );
  }
  if (part.type === "wallet_address") {
    const wallets = part.wallets ?? {};
    return (
      <div className="terminal-part">
        {Object.entries(wallets).map(([chain, value]) =>
          value ? (
            <div key={chain} className="terminal-kv">
              <span>{chain}</span>
              <strong>
                {shortAddress(String((value as Record<string, unknown>).address ?? ""))}
              </strong>
            </div>
          ) : null,
        )}
      </div>
    );
  }
  if (part.type === "token_card") {
    const detail = part.detail ?? {};
    return (
      <div className="terminal-part">
        <div className="terminal-kv">
          <span>Token</span>
          <strong>
            {String(
              (detail.metadata as Record<string, unknown> | undefined)?.symbol ??
                (detail as Record<string, unknown>).token_address ??
                "Token",
            )}
          </strong>
        </div>
        <div className="terminal-kv">
          <span>Chain</span>
          <strong>
            {String(
              (detail as Record<string, unknown>).chain_label ??
                (detail as Record<string, unknown>).chain ??
                "unknown",
            )}
          </strong>
        </div>
      </div>
    );
  }
  if (part.type === "transaction_receipt") {
    const result = part.result ?? {};
    return (
      <div className="terminal-part terminal-receipt">
        <Check aria-hidden="true" size={16} />
        <span>{String(result.summary ?? "Action handled")}</span>
      </div>
    );
  }
  if (part.text || part.label || part.title) {
    return (
      <div className="terminal-part">
        <strong>{part.title ?? part.label ?? part.type}</strong>
        {part.text && <p>{part.text}</p>}
      </div>
    );
  }
  return null;
}

function PendingActionCard({
  action,
  onAction,
  compact = false,
}: {
  action: PendingAction;
  onAction: (id: string, action: "confirm" | "cancel") => void;
  compact?: boolean;
}) {
  return (
    <div className="terminal-pending-card" data-compact={compact}>
      <div>
        <strong>{labelAction(action.action_type)}</strong>
        <p>{action.summary}</p>
        <small>Expires {relativeTime(action.expires_at)}</small>
      </div>
      <div className="terminal-pending-actions">
        <button type="button" onClick={() => onAction(action.id, "confirm")}>
          <Check aria-hidden="true" size={15} />
          <span>Confirm</span>
        </button>
        <button type="button" onClick={() => onAction(action.id, "cancel")}>
          <X aria-hidden="true" size={15} />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
}

function TypingBubble({ label, inline = false }: { label: string; inline?: boolean }) {
  return (
    <div className={inline ? "terminal-typing terminal-typing-inline" : "terminal-typing"}>
      <span />
      <span />
      <span />
      <b>{label}</b>
    </div>
  );
}

async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.message ?? json?.error ?? `Request failed (${response.status})`));
  }
  return json as T;
}

async function apiMultipart<T = unknown>(path: string, init: { body: FormData }): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(path, {
    ...init,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: init.body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.message ?? json?.error ?? `Request failed (${response.status})`));
  }
  return json as T;
}

async function uploadTerminalImage(file: File): Promise<TerminalChatAttachment> {
  const normalizedType = normalizeMimeType(file.type);
  if (!normalizedType) {
    throw new Error("Only PNG, JPG, GIF, and WEBP images are supported.");
  }
  if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
    throw new Error("Image must be between 1 byte and 4MB.");
  }
  const formData = new FormData();
  formData.append("image", file);
  const response = await apiMultipart<{
    source_url: string;
    storage_path: string | null;
    mime_type: string;
    width: number;
    height: number;
    byte_length: number;
  }>("/api/terminal/uploads", { body: formData });
  return {
    kind: "image",
    source_url: response.source_url,
    storage_path: response.storage_path ?? null,
    mime_type: response.mime_type,
    width: response.width,
    height: response.height,
    byte_length: response.byte_length,
  };
}

async function streamTerminalChat(
  body: Record<string, unknown>,
  handlers: Record<string, (payload: Record<string, unknown>) => void | Promise<void>>,
) {
  const token = await getAuthToken();
  const response = await fetch("/api/terminal/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    const message =
      typeof error?.error === "object"
        ? (error.error?.message ?? error.error?.code)
        : (error?.message ?? error?.error);
    throw new Error(String(message ?? "Terminal request failed"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingCarriageReturn = false;
  let terminalEventSeen = false;
  const maxEventBytes = 256 * 1024;

  const normalizeChunk = (chunk: string, final = false) => {
    let value = (pendingCarriageReturn ? "\r" : "") + chunk;
    pendingCarriageReturn = false;
    if (!final && value.endsWith("\r")) {
      pendingCarriageReturn = true;
      value = value.slice(0, -1);
    }
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  };

  const processBlock = async (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("Linkr returned an invalid stream event.");
    }
    if (event === "complete" || event === "error") terminalEventSeen = true;
    await handlers[event]?.(payload);
  };

  const drain = async () => {
    if (buffer.length > maxEventBytes) {
      await reader.cancel("terminal_stream_event_too_large").catch(() => {});
      throw new Error("Linkr returned an oversized stream event.");
    }
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      await processBlock(block);
      index = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += normalizeChunk(decoder.decode(value, { stream: true }));
    await drain();
  }
  buffer += normalizeChunk(decoder.decode(), true);
  await drain();
  if (buffer.trim()) await processBlock(buffer.trim());
  if (!terminalEventSeen) {
    throw new Error("The Linkr stream ended before the turn completed.");
  }
}

function getMessageAttachments(message: TerminalMessage): TerminalChatAttachment[] {
  const raw = message.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeTerminalAttachment(item))
    .filter((item): item is TerminalChatAttachment => item !== null)
    .slice(0, MAX_TERMINAL_ATTACHMENTS);
}

function normalizeTerminalAttachment(item: unknown): TerminalChatAttachment | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  if (String(source.kind ?? "") !== "image") return null;
  const sourceUrl = safeTerminalImageUrl(source.source_url);
  if (!sourceUrl) return null;
  return {
    kind: "image",
    source_url: sourceUrl,
    storage_path: typeof source.storage_path === "string" ? source.storage_path : null,
    mime_type: typeof source.mime_type === "string" ? source.mime_type : null,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : null,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : null,
    byte_length: Number.isFinite(Number(source.byte_length)) ? Number(source.byte_length) : null,
  };
}

function safeTerminalImageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeMimeType(value: string): string {
  const normalized = String(value ?? "")
    .toLowerCase()
    .split(";", 1)[0]
    .trim();
  if (!normalized) return "";
  if (normalized === "image/jpg") return "image/jpeg";
  if (
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/webp" ||
    normalized === "image/gif"
  ) {
    return normalized;
  }
  return "";
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

function labelAction(value: string) {
  return value.replace(/_/g, " ");
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  } catch {
    return "";
  }
}

function formatAmount(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1 ? 4 : 8 });
}
