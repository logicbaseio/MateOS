import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, CheckCircle2, XCircle, Clock, RefreshCw,
  ChevronDown, ChevronUp, Send, Search, Filter,
  AlertCircle, MessageSquareDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBotName } from "@/hooks/use-preferences";

type NotifStatus = "pending" | "replied" | "dismissed" | "delivery_failed";

interface Notification {
  id: number;
  channelType: string;
  externalId: string;
  sessionId: string | null;
  notificationText: string;
  customerContext: string | null;
  status: NotifStatus;
  bossReply: string | null;
  createdAt: string;
  updatedAt: string;
}

const CHANNEL_META: Record<string, { label: string; color: string; bg: string }> = {
  telegram:  { label: "Telegram",  color: "text-sky-500",    bg: "bg-sky-500/10" },
  slack:     { label: "Slack",     color: "text-purple-400",  bg: "bg-purple-500/10" },
  whatsapp:  { label: "WhatsApp",  color: "text-emerald-500", bg: "bg-emerald-500/10" },
  teams:     { label: "Teams",     color: "text-blue-500",    bg: "bg-blue-500/10" },
  discord:   { label: "Discord",   color: "text-violet-400",  bg: "bg-violet-500/10" },
  voice:     { label: "Voice",     color: "text-[#0078d4]",   bg: "bg-[#0078d4]/10" },
};

const STATUS_META: Record<NotifStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:          { label: "Pending",          color: "text-amber-600",    bg: "bg-amber-500/10",   icon: <Clock size={12} /> },
  replied:          { label: "Replied",           color: "text-[#0078d4]",   bg: "bg-[#0078d4]/10",   icon: <CheckCircle2 size={12} /> },
  dismissed:        { label: "Dismissed",         color: "text-muted-foreground", bg: "bg-muted",     icon: <XCircle size={12} /> },
  delivery_failed:  { label: "Delivery Failed",   color: "text-red-500",     bg: "bg-red-500/10",     icon: <AlertCircle size={12} /> },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ChannelBadge({ type }: { type: string }) {
  const meta = CHANNEL_META[type] ?? { label: type, color: "text-muted-foreground", bg: "bg-muted" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider", meta.color, meta.bg)}>
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: NotifStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold", meta.color, meta.bg)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function RequestRow({
  n,
  isExpanded,
  onToggle,
  onReply,
  onDismiss,
}: {
  n: Notification;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: (id: number, text: string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
}) {
  const botName = useBotName();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isExpanded && n.status === "pending" && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [isExpanded, n.status]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await onReply(n.id, reply.trim());
      setReply("");
    } finally {
      setSending(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(n.id);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className={cn(
      "border-b border-border last:border-0 transition-colors",
      n.status === "pending" ? "bg-amber-500/3 hover:bg-amber-500/5" : "hover:bg-muted/30"
    )}>
      {/* Row */}
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer"
        onClick={onToggle}
      >
        {/* Status dot */}
        <div className="mt-1 shrink-0">
          {n.status === "pending" && (
            <span className="block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          )}
          {n.status === "replied" && (
            <span className="block w-2 h-2 rounded-full bg-[#0078d4]" />
          )}
          {n.status === "dismissed" && (
            <span className="block w-2 h-2 rounded-full bg-border" />
          )}
          {n.status === "delivery_failed" && (
            <span className="block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <ChannelBadge type={n.channelType} />
            <StatusBadge status={n.status} />
            <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{timeAgo(n.createdAt)}</span>
          </div>

          {n.customerContext && (
            <p className="text-[11px] text-muted-foreground mb-0.5 truncate">
              <span className="font-medium text-foreground/70">Context: </span>
              {n.customerContext}
            </p>
          )}

          <p className="text-sm text-foreground leading-snug line-clamp-2">
            {n.notificationText}
          </p>

          {n.bossReply && !isExpanded && (
            <p className="text-[11px] text-[#0078d4] mt-1 truncate">
              <span className="font-medium">Your reply: </span>{n.bossReply}
            </p>
          )}
        </div>

        {/* Expand chevron */}
        <div className="shrink-0 text-muted-foreground mt-1">
          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </div>

      {/* Expanded panel */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3 ml-5">
              {/* Full context */}
              {n.customerContext && (
                <div className="rounded-xl bg-muted/50 border border-border px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Customer Context</p>
                  <p className="text-sm text-foreground leading-relaxed">{n.customerContext}</p>
                </div>
              )}

              {/* Full request */}
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-1">{botName} needs your input</p>
                <p className="text-sm text-foreground leading-relaxed">{n.notificationText}</p>
              </div>

              {/* Replied view */}
              {n.status === "replied" && n.bossReply && (
                <div className="rounded-xl bg-[#0078d4]/5 border border-[#0078d4]/20 px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#0078d4] uppercase tracking-wider mb-1">Your Reply</p>
                  <p className="text-sm text-foreground leading-relaxed">{n.bossReply}</p>
                </div>
              )}

              {/* Dismissed */}
              {n.status === "dismissed" && (
                <div className="rounded-xl bg-muted border border-border px-3 py-2">
                  <p className="text-sm text-muted-foreground">This request was dismissed without a reply.</p>
                </div>
              )}

              {/* Delivery failed */}
              {n.status === "delivery_failed" && (
                <div className="rounded-xl bg-red-500/5 border border-red-500/30 px-3 py-2 space-y-1">
                  <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wider">WhatsApp Delivery Failed</p>
                  <p className="text-sm text-foreground leading-relaxed">
                    The bot could not send this notification to your WhatsApp. This usually means there is no active session — WhatsApp only allows the bot to send you a message if you have messaged it first within the last 24 hours.
                  </p>
                  <p className="text-sm font-medium text-foreground mt-1">
                    To fix this: send any message to the bot's WhatsApp number from your personal phone. This opens the session window and future notifications will reach you.
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">You can still reply to this request here using the input below.</p>
                </div>
              )}

              {/* Reply input for pending or delivery_failed */}
              {(n.status === "pending" || n.status === "delivery_failed") && (
                <div className="space-y-2">
                  <textarea
                    ref={textareaRef}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        void handleReply();
                      }
                    }}
                    placeholder={`Type your reply… ${botName} will relay it to the customer`}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078d4]/30 placeholder:text-muted-foreground leading-relaxed"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReply}
                      disabled={sending || !reply.trim()}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      <Send size={12} />
                      {sending ? "Sending…" : "Send Reply"}
                    </button>
                    <span className="text-[11px] text-muted-foreground">⌘↵ to send</span>
                    <button
                      onClick={handleDismiss}
                      disabled={dismissing}
                      className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-40"
                    >
                      <XCircle size={12} />
                      {dismissing ? "…" : "Dismiss"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type FilterTab = "all" | "pending" | "replied" | "dismissed";

export default function Approvals() {
  const botName = useBotName();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const fetchAll = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/channels/notifications?view=all");
      if (!res.ok) return;
      const data = await res.json() as { all: Notification[] };
      setNotifications(data.all ?? []);
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, []);

  useEffect(() => {
    void fetchAll(true);
    const interval = setInterval(() => void fetchAll(), 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleReply = async (id: number, text: string) => {
    const res = await fetch(`/api/channels/notifications/${id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: text }),
    });
    if (res.ok) {
      setExpandedId(null);
      await fetchAll();
    }
  };

  const handleDismiss = async (id: number) => {
    const res = await fetch(`/api/channels/notifications/${id}/dismiss`, {
      method: "POST",
    });
    if (res.ok) {
      setExpandedId(null);
      await fetchAll();
    }
  };

  const pending   = notifications.filter((n) => n.status === "pending");
  const replied   = notifications.filter((n) => n.status === "replied");
  const dismissed = notifications.filter((n) => n.status === "dismissed");

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "pending",   label: "Pending",   count: pending.length },
    { key: "replied",   label: "Replied",   count: replied.length },
    { key: "dismissed", label: "Dismissed", count: dismissed.length },
    { key: "all",       label: "All",       count: notifications.length },
  ];

  const filtered = (() => {
    let base: Notification[];
    if (filter === "pending")   base = pending;
    else if (filter === "replied")   base = replied;
    else if (filter === "dismissed") base = dismissed;
    else base = notifications;

    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (n) =>
        n.notificationText.toLowerCase().includes(q) ||
        (n.customerContext ?? "").toLowerCase().includes(q) ||
        n.channelType.toLowerCase().includes(q),
    );
  })();

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Approvals & Requests</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            All requests from {botName} that need your response — reply here or via your connected channel
          </p>
        </div>
        <button
          onClick={() => void fetchAll(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-card border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Clock size={16} className="text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{pending.length}</p>
            <p className="text-xs text-muted-foreground">Awaiting reply</p>
          </div>
        </div>
        <div className="rounded-2xl bg-card border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0078d4]/10 flex items-center justify-center">
            <CheckCircle2 size={16} className="text-[#0078d4]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{replied.length}</p>
            <p className="text-xs text-muted-foreground">Replied</p>
          </div>
        </div>
        <div className="rounded-2xl bg-card border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
            <MessageSquare size={16} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{notifications.length}</p>
            <p className="text-xs text-muted-foreground">Total requests</p>
          </div>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                filter === t.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span className={cn(
                  "min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1",
                  filter === t.key && t.key === "pending"
                    ? "bg-amber-500 text-white"
                    : filter === t.key
                    ? "bg-[#0078d4] text-white"
                    : "bg-border text-muted-foreground"
                )}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search requests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#0078d4]/30 placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Table header */}
        <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center gap-3">
          <Filter size={12} className="text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {filtered.length} request{filtered.length !== 1 ? "s" : ""}
            {search && ` matching "${search}"`}
          </span>
          {pending.length > 0 && filter !== "pending" && (
            <span className="ml-auto text-[11px] text-amber-600 font-medium flex items-center gap-1">
              <AlertCircle size={11} />
              {pending.length} still awaiting reply
            </span>
          )}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw size={18} className="animate-spin mr-2" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquareDot size={32} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">
              {filter === "pending" ? "No pending requests" : "No requests here"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === "pending"
                ? `${botName} is handling everything — you're all caught up!`
                : search
                ? "Try a different search term"
                : "Nothing to show for this filter"}
            </p>
          </div>
        ) : (
          <div>
            <AnimatePresence initial={false}>
              {filtered.map((n) => (
                <motion.div
                  key={n.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <RequestRow
                    n={n}
                    isExpanded={expandedId === n.id}
                    onToggle={() => setExpandedId(expandedId === n.id ? null : n.id)}
                    onReply={handleReply}
                    onDismiss={handleDismiss}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[11px] text-muted-foreground text-center">
        Replies here are also delivered via your connected channel (Telegram, Slack, etc.) — auto-refreshes every 15s
      </p>
    </div>
  );
}
