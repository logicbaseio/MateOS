import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, Calendar, Users, CheckCircle2, RefreshCw,
  ChevronDown, ChevronUp, Send, Loader2,
  Clock, Star, Paperclip, User, Building2,
  PlugZap, Unplug, Plus, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────── types ─────────────────────────── */
interface MSStatus {
  connected: boolean;
  userEmail?: string;
  displayName?: string;
  expiresAt?: string;
}
interface CalendarEvent {
  id: string; subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  organizer?: { emailAddress: { name: string; address: string } };
  bodyPreview?: string; isAllDay?: boolean;
}
interface MailMessage {
  id: string; subject: string;
  from: { emailAddress: { name: string; address: string } };
  receivedDateTime: string; bodyPreview: string;
  isRead: boolean; importance: string; hasAttachments: boolean;
}
interface Team { id: string; displayName: string; description?: string; }
interface Channel { id: string; displayName: string; description?: string; }
interface TeamsChat {
  id: string;
  topic?: string | null;
  chatType: "oneOnOne" | "group" | "meeting" | string;
  lastUpdatedDateTime?: string;
  members?: Array<{ id: string; displayName?: string; userId?: string; roles?: string[] }>;
}
interface TeamsMessage {
  id: string;
  body?: { content?: string; contentType?: string };
  from?: { user?: { displayName?: string; id?: string } };
  createdDateTime?: string;
  messageType?: string;
}

/* ─────────────────────────── helpers ─────────────────────────── */
function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function fmtTime(e: CalendarEvent) {
  if (e.isAllDay) return "All day";
  const s = new Date(e.start.dateTime), en = new Date(e.end.dateTime);
  return `${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
function fmtDate(e: CalendarEvent) {
  const d = new Date(e.start.dateTime), t = new Date(), tm = new Date(t);
  tm.setDate(t.getDate() + 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === tm.toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/* ─────────────────────────── Calendar tab ─────────────────────────── */
function CalendarTab() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ subject: "", date: "", start: "09:00", end: "10:00", attendees: "", location: "", body: "" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`/api/microsoft/calendar/events?days=${days}`);
      const d = await r.json() as { events: CalendarEvent[]; error?: string };
      if (!r.ok || d.error) {
        setLoadError("Could not load calendar. Check that your Microsoft account has calendar access enabled.");
        setEvents([]);
      } else {
        setEvents(d.events ?? []);
      }
    } catch {
      setLoadError("Could not load calendar. Check your connection and try again.");
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.subject || !form.date) return;
    setCreating(true);
    try {
      const r = await fetch("/api/microsoft/calendar/event", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: form.subject,
          start: `${form.date}T${form.start}:00`,
          end: `${form.date}T${form.end}:00`,
          attendees: form.attendees ? form.attendees.split(",").map(e => e.trim()) : undefined,
          location: form.location || undefined, body: form.body || undefined,
        }),
      });
      if (r.ok) { setMsg("Event created!"); setShowNew(false); setForm({ subject: "", date: "", start: "09:00", end: "10:00", attendees: "", location: "", body: "" }); void load(); }
      else setMsg("Failed to create");
    } finally { setCreating(false); setTimeout(() => setMsg(null), 3000); }
  };

  const grouped = events.reduce<Record<string, CalendarEvent[]>>((a, e) => {
    const k = fmtDate(e); if (!a[k]) a[k] = []; a[k].push(e); return a;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-colors", days === d ? "bg-[#0078d4] text-white" : "bg-muted text-muted-foreground hover:text-foreground")}>
              {d}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-[#0078d4]">{msg}</span>}
          <button onClick={() => setShowNew(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-medium transition-colors">
            <Plus size={12} /> New Event
          </button>
          <button onClick={() => void load()} className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground transition-colors">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {loadError && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
          {loadError}
        </div>
      )}
      <AnimatePresence>
        {showNew && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-2xl border border-[#0078d4]/20 bg-[#0078d4]/5 p-4 space-y-3">
              <p className="text-sm font-semibold">New Calendar Event</p>
              <div className="grid grid-cols-2 gap-3">
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Event title *" className="input-field col-span-2" />
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" />
                <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Location" className="input-field" />
                <div className="flex items-center gap-2 col-span-2">
                  <input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className="input-field flex-1" />
                  <span className="text-muted-foreground text-xs shrink-0">to</span>
                  <input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className="input-field flex-1" />
                </div>
                <input value={form.attendees} onChange={e => setForm(f => ({ ...f, attendees: e.target.value }))} placeholder="Attendees (comma-separated emails)" className="input-field col-span-2" />
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Notes" rows={2} className="input-field resize-none col-span-2" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => void create()} disabled={creating || !form.subject || !form.date}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  {creating ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowNew(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground"><Calendar size={28} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No events in the next {days} days</p></div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([day, dayEvents]) => (
            <div key={day}>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">{day}</p>
              <div className="space-y-1.5">
                {dayEvents.map(ev => (
                  <div key={ev.id} className="rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3">
                    <div className="w-1 self-stretch rounded-full bg-[#0078d4] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ev.subject}</p>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock size={11} />{fmtTime(ev)}</span>
                        {ev.location?.displayName && <span className="flex items-center gap-1"><Building2 size={11} />{ev.location.displayName}</span>}
                        {ev.organizer && <span className="flex items-center gap-1"><User size={11} />{ev.organizer.emailAddress.name}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Mail tab ─────────────────────────── */
function MailTab() {
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/microsoft/mail/inbox?top=25");
      const d = await r.json() as { messages: MailMessage[]; error?: string };
      if (!r.ok || d.error) {
        const isAccessDenied = (d.error ?? "").includes("403") || (d.error ?? "").includes("AccessDenied");
        setLoadError(
          isAccessDenied
            ? "Email access is blocked by your organisation's IT policy. Your admin needs to grant MateOS permission to access Outlook in the Azure portal (Enterprise Applications → MateOS → Permissions → Grant admin consent)."
            : "Could not load emails. Check your Microsoft connection."
        );
        setMessages([]);
      } else {
        setMessages(d.messages ?? []);
      }
    } catch {
      setLoadError("Could not load emails. Check your connection and try again.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!compose.to || !compose.subject || !compose.body) return;
    setSending(true);
    try {
      const r = await fetch("/api/microsoft/mail/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compose) });
      if (r.ok) { setMsg("Sent!"); setCompose({ to: "", subject: "", body: "" }); setShowCompose(false); }
      else setMsg("Failed to send");
    } finally { setSending(false); setTimeout(() => setMsg(null), 3000); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{messages.filter(m => !m.isRead).length} unread</p>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-[#0078d4]">{msg}</span>}
          <button onClick={() => setShowCompose(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-medium transition-colors">
            <Send size={12} /> Compose
          </button>
          <button onClick={() => void load()} className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground transition-colors">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {loadError && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
          {loadError}
        </div>
      )}
      <AnimatePresence>
        {showCompose && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-2xl border border-[#0078d4]/20 bg-[#0078d4]/5 p-4 space-y-3">
              <p className="text-sm font-semibold">New Email</p>
              <input value={compose.to} onChange={e => setCompose(c => ({ ...c, to: e.target.value }))} placeholder="To" className="input-field" />
              <input value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} placeholder="Subject" className="input-field" />
              <textarea value={compose.body} onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} placeholder="Message…" rows={4} className="input-field resize-none" />
              <div className="flex gap-2">
                <button onClick={() => void send()} disabled={sending || !compose.to || !compose.subject || !compose.body}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {sending ? "Sending…" : "Send"}
                </button>
                <button onClick={() => setShowCompose(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {loading ? (
        <div className="space-y-1.5">{[1, 2, 3, 4].map(i => <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : messages.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground"><Mail size={28} className="mx-auto mb-2 opacity-30" /><p className="text-sm">Inbox is empty</p></div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          {messages.map(m => (
            <div key={m.id} className={cn("border-b border-border last:border-0 transition-colors", !m.isRead ? "bg-[#0078d4]/3" : "bg-card", expanded === m.id ? "bg-muted/30" : "hover:bg-muted/20")}>
              <div className="flex items-start gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                <div className={cn("w-1.5 h-1.5 rounded-full mt-2 shrink-0", !m.isRead ? "bg-[#0078d4]" : "bg-transparent")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-sm truncate", !m.isRead ? "font-semibold" : "text-foreground/80")}>{m.from.emailAddress.name || m.from.emailAddress.address}</span>
                    {m.importance === "high" && <Star size={11} className="text-amber-400 shrink-0" />}
                    {m.hasAttachments && <Paperclip size={11} className="text-muted-foreground shrink-0" />}
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{timeAgo(m.receivedDateTime)}</span>
                  </div>
                  <p className={cn("text-xs truncate", !m.isRead ? "text-foreground/80 font-medium" : "text-muted-foreground")}>{m.subject}</p>
                  {expanded !== m.id && <p className="text-xs text-muted-foreground truncate mt-0.5">{m.bodyPreview}</p>}
                </div>
                {expanded === m.id ? <ChevronUp size={13} className="text-muted-foreground mt-1 shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground mt-1 shrink-0" />}
              </div>
              <AnimatePresence>
                {expanded === m.id && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border/50">
                    <div className="px-4 py-3 ml-4">
                      <p className="text-xs text-muted-foreground mb-2">{m.from.emailAddress.address}</p>
                      <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{m.bodyPreview}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Teams tab ─────────────────────────── */
function chatName(chat: TeamsChat, myEmail?: string): string {
  if (chat.topic) return chat.topic;
  if (chat.members && chat.members.length > 0) {
    const others = myEmail
      ? chat.members.filter(m => {
          const email = (m as unknown as { email?: string }).email ?? "";
          return email !== myEmail && m.displayName;
        })
      : chat.members.filter(m => m.displayName);
    const names = (others.length > 0 ? others : chat.members.filter(m => m.displayName))
      .map(m => m.displayName)
      .join(", ");
    if (names) return names;
  }
  return chat.chatType === "group" ? "Group chat" : "Chat";
}

function TeamsTab({ myEmail }: { myEmail?: string }) {
  const [chats, setChats] = useState<TeamsChat[]>([]);
  const [messages, setMessages] = useState<Record<string, TeamsMessage[]>>({});
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/microsoft/chats");
        const d = await r.json() as { chats: TeamsChat[]; error?: string };
        setChats(d.chats ?? []);
      } finally { setLoading(false); }
    };
    void load();
  }, []);

  const selectChat = async (id: string) => {
    setSelectedChat(id);
    if (messages[id]) return;
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/microsoft/chats/${id}/messages`);
      const d = await r.json() as { messages: TeamsMessage[] };
      setMessages(m => ({ ...m, [id]: (d.messages ?? []).filter(msg => msg.messageType === "message").reverse() }));
    } finally { setLoadingMsgs(false); }
  };

  const sendMsg = async () => {
    if (!selectedChat || !message.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/microsoft/chats/${selectedChat}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: message.trim() }),
      });
      if (r.ok) {
        setStatusMsg("Sent!");
        setMessage("");
        const r2 = await fetch(`/api/microsoft/chats/${selectedChat}/messages`);
        const d2 = await r2.json() as { messages: TeamsMessage[] };
        setMessages(m => ({ ...m, [selectedChat]: (d2.messages ?? []).filter(msg => msg.messageType === "message").reverse() }));
      } else { setStatusMsg("Failed to send"); }
    } finally { setSending(false); setTimeout(() => setStatusMsg(null), 3000); }
  };

  const selectedMsgs = selectedChat ? (messages[selectedChat] ?? []) : [];

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />)}</div>
      ) : chats.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No chats found</p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-3 min-h-[300px]">
          {/* Chat list */}
          <div className="col-span-2 space-y-1 overflow-y-auto max-h-[400px] pr-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Chats</p>
            {chats.map(chat => (
              <button key={chat.id} onClick={() => void selectChat(chat.id)}
                className={cn("w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors", selectedChat === chat.id ? "bg-[#0078d4] text-white" : "bg-muted/40 text-foreground hover:bg-muted")}>
                <div className="flex items-center gap-2">
                  <div className={cn("shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold",
                    selectedChat === chat.id ? "bg-white/20 text-white" : "bg-[#0078d4]/10 text-[#0078d4]")}>
                    {chat.chatType === "group" ? "G" : chatName(chat, myEmail).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate text-[13px]">{chatName(chat, myEmail)}</p>
                    {chat.lastUpdatedDateTime && (
                      <p className={cn("text-[11px] truncate", selectedChat === chat.id ? "text-white/70" : "text-muted-foreground")}>
                        {timeAgo(chat.lastUpdatedDateTime)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Messages pane */}
          <div className="col-span-3 flex flex-col gap-2">
            {!selectedChat ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm flex-1">
                Select a chat to view messages
              </div>
            ) : loadingMsgs ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl bg-muted/50 animate-pulse" />)}</div>
            ) : (
              <>
                <div className="flex-1 space-y-2 max-h-[260px] overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
                  {selectedMsgs.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No messages</p>
                  ) : selectedMsgs.map(msg => (
                    <div key={msg.id} className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">{msg.from?.user?.displayName ?? "Unknown"}</span>
                        {msg.createdDateTime && <span className="text-muted-foreground">{timeAgo(msg.createdDateTime)}</span>}
                      </div>
                      <p className="text-foreground/80 leading-relaxed pl-0.5">
                        {msg.body?.contentType === "html"
                          ? msg.body.content?.replace(/<[^>]+>/g, "") ?? ""
                          : msg.body?.content ?? ""}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <textarea value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="Type a message…" rows={2}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078d4]/30 placeholder:text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => void sendMsg()} disabled={sending || !message.trim()}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0078d4] hover:bg-[#006cbe] text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                      {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {sending ? "Sending…" : "Send"}
                    </button>
                    {statusMsg && <span className="text-xs text-[#0078d4]">{statusMsg}</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Microsoft card ─────────────────────────── */
type MSTab = "calendar" | "mail" | "teams";

function MicrosoftIntegration() {
  const [status, setStatus] = useState<MSStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<MSTab>("calendar");

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/microsoft/status");
      setStatus(await r.json() as MSStatus);
    } catch { /**/ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ms-auth-success") { setConnecting(false); void fetchStatus(); setExpanded(true); }
      else if (e.data?.type === "ms-auth-error") setConnecting(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [fetchStatus]);

  const connect = async () => {
    setConnecting(true);
    const r = await fetch("/api/microsoft/auth-url");
    const d = await r.json() as { url?: string; error?: string };
    if (!d.url) { setConnecting(false); return; }
    const popup = window.open(d.url, "ms-auth", "width=600,height=700,scrollbars=yes");
    if (!popup) { window.location.href = d.url; return; }
    const iv = setInterval(() => { if (popup.closed) { setConnecting(false); void fetchStatus(); clearInterval(iv); } }, 1000);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch("/api/microsoft/disconnect", { method: "POST" });
    setStatus({ connected: false }); setDisconnecting(false); setExpanded(false);
  };

  const tabs: { key: MSTab; label: string; icon: string }[] = [
    { key: "calendar", label: "Calendar", icon: "https://img.icons8.com/color/48/outlook-calendar.png" },
    { key: "mail", label: "Outlook", icon: "https://img.icons8.com/color/48/microsoft-outlook-2025.png" },
    { key: "teams", label: "Teams", icon: "https://img.icons8.com/fluency/48/microsoft-teams-2019.png" },
  ];

  const serviceStrip: { label: string; icon: string; soon?: boolean }[] = [
    { label: "Calendar", icon: "https://img.icons8.com/color/48/outlook-calendar.png" },
    { label: "Outlook", icon: "https://img.icons8.com/color/48/microsoft-outlook-2025.png" },
    { label: "Teams", icon: "https://img.icons8.com/fluency/48/microsoft-teams-2019.png" },
    { label: "Word", icon: "https://img.icons8.com/color/48/microsoft-word-2019--v2.png", soon: true },
    { label: "Excel", icon: "https://img.icons8.com/color/48/microsoft-excel-2019.png", soon: true },
    { label: "PowerPoint", icon: "https://img.icons8.com/color/48/microsoft-powerpoint-2019.png", soon: true },
    { label: "Dynamics CRM", icon: "https://img.icons8.com/color/48/dynamics-365.png", soon: true },
    { label: "SharePoint", icon: "https://img.icons8.com/color/48/microsoft-sharepoint-2019.png", soon: true },
    { label: "OneDrive", icon: "https://img.icons8.com/color/48/microsoft-onedrive-2019.png", soon: true },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Card header */}
      <div className="p-5 flex items-start gap-4">
        <img src="https://img.icons8.com/fluency/96/microsoft-365.png" alt="Microsoft 365" width={44} height={44} className="rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-foreground">Microsoft 365</h3>
            {!loading && (
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
                status?.connected ? "bg-[#0078d4]/10 text-[#0078d4]" : "bg-muted text-muted-foreground")}>
                {status?.connected ? <><CheckCircle2 size={10} /> Connected</> : "Not connected"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Calendar · Outlook · Teams · Word · Excel · PowerPoint · Dynamics CRM · SharePoint · OneDrive
          </p>
          {status?.connected && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <User size={11} />
              {status.displayName ?? status.userEmail}
              {status.displayName && <span className="opacity-60">· {status.userEmail}</span>}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          ) : status?.connected ? (
            <>
              <button onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors">
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? "Hide" : "Manage"}
              </button>
              <button onClick={() => void disconnect()} disabled={disconnecting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors">
                {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={() => void connect()} disabled={connecting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0078d4] hover:bg-[#006cbe] text-white text-sm font-semibold transition-colors disabled:opacity-60">
              {connecting ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>

      {/* Service icons strip */}
      <div className="px-5 pb-4 flex items-center flex-wrap gap-3">
        {serviceStrip.map(s => (
          <div key={s.label} className={cn("flex items-center gap-1.5 text-xs", s.soon ? "text-muted-foreground/50" : "text-muted-foreground")}>
            <img src={s.icon} alt="" width={16} height={16} className={s.soon ? "opacity-40" : ""} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            {s.label}
            {s.soon && <span className="text-[9px] bg-muted px-1 py-0.5 rounded font-medium">soon</span>}
          </div>
        ))}
      </div>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && status?.connected && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="border-t border-border">
              {/* Tabs */}
              <div className="flex gap-0.5 p-3 bg-muted/30">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      activeTab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <img src={t.icon} alt={t.label} width={16} height={16} />
                    {t.label}
                  </button>
                ))}
              </div>
              {/* Tab content */}
              <div className="p-5">
                {activeTab === "calendar" && <CalendarTab />}
                {activeTab === "mail" && <MailTab />}
                {activeTab === "teams" && <TeamsTab myEmail={status?.userEmail} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connecting overlay */}
      {connecting && (
        <div className="border-t border-border px-5 py-3 bg-[#0078d4]/5 flex items-center gap-2 text-xs text-[#0078d4]">
          <Loader2 size={13} className="animate-spin" />
          Waiting for Microsoft sign-in in the popup window…
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Future integration placeholder ─────────────────────────── */
function ComingSoonCard({ name, icon, description }: { name: string; icon: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-5 flex items-start gap-4 opacity-60">
      <img src={icon} alt={name} width={44} height={44} className="rounded-xl shrink-0 grayscale" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{name}</h3>
          <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold">Coming soon</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Main page ─────────────────────────── */
export default function Integrations() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect MateOS to the apps and services you use — the Brain can then read, write, and act across all of them
        </p>
      </div>

      <MicrosoftIntegration />

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Coming soon</p>
        <ComingSoonCard
          name="Google Workspace"
          icon="https://img.icons8.com/color/96/google-logo.png"
          description="Gmail · Google Calendar · Google Drive"
        />
        <ComingSoonCard
          name="Slack"
          icon="https://img.icons8.com/color/96/slack.png"
          description="Read channels, send messages, create workflows"
        />
        <ComingSoonCard
          name="HubSpot"
          icon="https://img.icons8.com/external-tal-revivo-color-tal-revivo/96/external-hubspot-a-developer-and-marketer-of-software-products-logo-color-tal-revivo.png"
          description="CRM contacts, deals, pipelines, and email sequences"
        />
      </div>
    </div>
  );
}
