"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError, inboxWebSocketUrl } from "@/lib/api";

interface Thread {
  id: string;
  guestName: string;
  channel: string;
  unreadCount: number;
  lastMessagePreview: string | null;
}

interface Message {
  id: string;
  senderType: "guest" | "host" | "system" | "ai";
  content: string;
  createdAt: string;
}

export default function InboxPage() {
  const { session } = useSession();
  const token = session?.token ?? null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  activeThreadIdRef.current = activeThreadId;

  const loadThreads = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ threads: Thread[] }>("/api/v1/inbox/threads", token);
      setThreads(body.threads);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load threads");
    }
  }, [token]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      if (!token) return;
      try {
        const body = await apiFetch<{ messages: Message[] }>(`/api/v1/inbox/threads/${threadId}/messages`, token);
        setMessages(body.messages);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load messages");
      }
    },
    [token],
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeThreadId) void loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  // Live updates: a new message on the currently open thread is appended in place;
  // any other thread just gets refreshed in the sidebar (unread count / preview).
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(inboxWebSocketUrl(token));

    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data as string) as { threadId: string; message: Message };
      if (parsed.threadId === activeThreadIdRef.current) {
        setMessages((prev) => [...prev, parsed.message]);
      }
      void loadThreads();
    };

    return () => ws.close();
  }, [token, loadThreads]);

  async function sendMessage() {
    if (!token || !activeThreadId || !draft.trim()) return;
    try {
      await apiFetch(`/api/v1/inbox/threads/${activeThreadId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ content: draft }),
      });
      setDraft("");
      await loadMessages(activeThreadId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send message");
    }
  }

  async function suggestDraft() {
    if (!token || !activeThreadId) return;
    setIsSuggesting(true);
    try {
      const body = await apiFetch<{ draft: string }>(`/api/v1/inbox/threads/${activeThreadId}/suggest-reply`, token, {
        method: "POST",
      });
      setDraft(body.draft);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate a suggestion");
    } finally {
      setIsSuggesting(false);
    }
  }

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  return (
    <div className="flex h-screen">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-neutral-200">
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => setActiveThreadId(thread.id)}
            className={`block w-full border-b border-neutral-100 p-3 text-left text-sm ${
              activeThreadId === thread.id ? "bg-neutral-100" : "hover:bg-neutral-50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{thread.guestName}</span>
              {thread.unreadCount > 0 && (
                <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">{thread.unreadCount}</span>
              )}
            </div>
            <div className="truncate text-xs text-neutral-400">{thread.lastMessagePreview ?? "No messages yet"}</div>
          </button>
        ))}
        {threads.length === 0 && <p className="p-3 text-sm text-neutral-400">No conversations yet.</p>}
      </aside>

      <section className="flex flex-1 flex-col">
        {error && <p className="border-b border-red-100 bg-red-50 p-2 text-sm text-red-600">{error}</p>}

        {!activeThread ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">Select a conversation</div>
        ) : (
          <>
            <div className="border-b border-neutral-200 p-3 text-sm font-medium">
              {activeThread.guestName} <span className="text-neutral-400">via {activeThread.channel}</span>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                    message.senderType === "guest" ? "bg-neutral-100" : "ml-auto bg-neutral-900 text-white"
                  }`}
                >
                  {message.content}
                </div>
              ))}
            </div>
            <div className="border-t border-neutral-200 p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="Write a reply..."
                className="w-full resize-none rounded-md border border-neutral-300 p-2 text-sm"
              />
              <div className="mt-2 flex justify-between">
                <button
                  onClick={() => void suggestDraft()}
                  disabled={isSuggesting}
                  className="flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  <Sparkles size={16} />
                  {isSuggesting ? "Thinking..." : "Suggest AI Draft"}
                </button>
                <button
                  onClick={() => void sendMessage()}
                  disabled={!draft.trim()}
                  className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
