import { useState, useEffect, useRef, useCallback } from "react";
import { useBotName } from "@/hooks/use-preferences";
import {
  Send,
  Trash2,
  Loader2,
  BrainCircuit,
  Cpu,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  MessageSquareDot,
  ChevronUp,
  Wifi,
  WifiOff,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MS_INTEGRATIONS = [
  { key: "calendar", label: "Calendar", icon: "https://img.icons8.com/color/48/outlook-calendar.png" },
  { key: "outlook", label: "Outlook Mail", icon: "https://img.icons8.com/color/48/microsoft-outlook-2025.png" },
  { key: "teams", label: "Teams Chats", icon: "https://img.icons8.com/fluency/48/microsoft-teams-2019.png" },
] as const;
type MsIntegrationKey = (typeof MS_INTEGRATIONS)[number]["key"];

interface BrainMsg {
  id: number;
  role: string;
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  toolInput?: string | null;
  toolResult?: string | null;
  createdAt: string;
}

type StreamEvent =
  | { content: string }
  | { tool: string; status: "running" }
  | { tool: string; status: "done"; summary: string; result?: string }
  | { error: string }
  | { done: true };

interface ActiveTool {
  name: string;
  status: "running" | "done";
  result?: string;
}

type DisplayItem =
  | { kind: "user"; msg: BrainMsg }
  | { kind: "assistant"; msg: BrainMsg }
  | { kind: "tool"; msg: BrainMsg };

function toDisplayItems(msgs: BrainMsg[]): DisplayItem[] {
  return msgs.flatMap((m): DisplayItem[] => {
    if (m.role === "user") return [{ kind: "user", msg: m }];
    if (m.role === "assistant" && !m.toolCallId) return [{ kind: "assistant", msg: m }];
    if (m.role === "tool") return [{ kind: "tool", msg: m }];
    return [];
  });
}

function formatToolName(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toolSummary(name: string, result: string): string {
  const lines = result.split("\n").filter(Boolean);
  if (name === "get_dashboard_stats") return result.split("\n").slice(0, 3).join(" · ");
  if (lines.length === 0) return "Done";
  if (lines.length === 1) return lines[0].length > 80 ? lines[0].slice(0, 77) + "…" : lines[0];
  return `${lines.length} item${lines.length !== 1 ? "s" : ""} returned`;
}

function BossCallCard({ status, result }: { status: "running" | "done"; result?: string }) {
  const succeeded = result ? !result.toLowerCase().startsWith("failed") && !result.toLowerCase().startsWith("cannot") : false;
  return (
    <div className="flex gap-2.5 my-1.5 max-w-[85%]">
      <div className={cn(
        "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5",
        status === "running" ? "bg-amber-500/15" : succeeded ? "bg-green-500/15" : "bg-red-500/15"
      )}>
        {status === "running"
          ? <Loader2 size={14} className="text-amber-500 animate-spin" />
          : <PhoneCall size={14} className={succeeded ? "text-green-600" : "text-red-500"} />
        }
      </div>
      <div className={cn(
        "flex-1 rounded-xl border overflow-hidden text-xs",
        status === "running" ? "border-amber-500/30 bg-amber-500/5"
          : succeeded ? "border-green-500/30 bg-green-500/5"
          : "border-red-500/30 bg-red-500/5"
      )}>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={cn(
            "font-semibold",
            status === "running" ? "text-amber-600 dark:text-amber-400"
              : succeeded ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          )}>
            {status === "running" ? "Calling boss…" : succeeded ? "Boss call initiated" : "Boss call failed"}
          </span>
          {status === "done" && result && (
            <span className="text-muted-foreground truncate flex-1 text-[11px]">
              {result.replace(/^📞\s*/, "").slice(0, 80)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ name, status, result }: { name: string; status: "running" | "done"; result?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (name === "call_boss") {
    return <BossCallCard status={status} result={result} />;
  }

  return (
    <div className="flex gap-2.5 my-1.5 max-w-[85%]">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
        <Cpu size={14} className="text-primary" />
      </div>
      <div className="flex-1 rounded-xl border bg-muted/30 overflow-hidden text-xs">
        <button
          onClick={() => status === "done" && result && setExpanded(!expanded)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-left",
            status === "done" && result ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
          )}
        >
          {status === "running" ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
          ) : (
            <CheckCircle2 size={12} className="shrink-0 text-green-500" />
          )}
          <span className="font-medium text-foreground/80">{formatToolName(name)}</span>
          {status === "running" && (
            <span className="text-muted-foreground animate-pulse">running…</span>
          )}
          {status === "done" && result && (
            <span className="text-muted-foreground truncate flex-1">{toolSummary(name, result)}</span>
          )}
          {status === "done" && result && (
            expanded
              ? <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
              : <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
          )}
        </button>
        {expanded && result && (
          <div className="px-3 pb-2.5 border-t bg-muted/20">
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground leading-relaxed">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1 px-1">
      <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
      <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  { icon: "📊", text: "What's my overview right now?" },
  { icon: "📅", text: "Show me pending meeting requests" },
  { icon: "🚨", text: "List active Amazon alerts" },
  { icon: "✏️", text: "Make the bot more concise and punchy" },
  { icon: "✅", text: "Approve the first pending meeting request" },
  { icon: "🔀", text: "Route critical alerts to the DevOps channel" },
];

interface TeamsStatus {
  connected: boolean;
  chatId: string | null;
  teamId?: string | null;
  type: "chat" | "channel";
  chatName: string | null;
  expiresAt: string | null;
}

interface TeamsChat {
  id: string;
  name: string;
  chatType?: string;
  kind: "chat";
}

interface TeamsChannel {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  kind: "channel";
}

interface TelegramStatus {
  connected: boolean;
  pending?: boolean;
  botName?: string;
  chatId?: string;
  error?: string;
}

export default function Brain() {
  const botName = useBotName();
  const [allMessages, setAllMessages] = useState<BrainMsg[]>([]);
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [streamText, setStreamText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [hasSoul, setHasSoul] = useState(true);
  const [msConnected, setMsConnected] = useState(false);
  const [showIntegrationMenu, setShowIntegrationMenu] = useState(false);
  const [selectedIntegrations, setSelectedIntegrations] = useState<Set<MsIntegrationKey>>(new Set());
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus | null>(null);
  const [showTeamsPanel, setShowTeamsPanel] = useState(false);
  const [teamsChatList, setTeamsChatList] = useState<TeamsChat[]>([]);
  const [teamsChannelList, setTeamsChannelList] = useState<TeamsChannel[]>([]);
  const [isLoadingTeamsChats, setIsLoadingTeamsChats] = useState(false);
  const [isConnectingTeams, setIsConnectingTeams] = useState(false);
  const teamsMenuRef = useRef<HTMLDivElement>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [showTelegramPanel, setShowTelegramPanel] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [isTelegramConnecting, setIsTelegramConnecting] = useState(false);
  const telegramMenuRef = useRef<HTMLDivElement>(null);
  const integrationMenuRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [allMessages, streamText, activeTools, scrollToBottom]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/messages");
      if (res.ok) {
        const data: BrainMsg[] = await res.json();
        setAllMessages(data);
      }
    } catch { /* ignore network errors */ }
  }, []);

  const fetchTeamsStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/teams-status");
      if (res.ok) setTeamsStatus(await res.json() as TeamsStatus);
    } catch { /* ignore */ }
  }, []);

  const fetchTelegramStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/telegram-status");
      if (res.ok) setTelegramStatus(await res.json() as TelegramStatus);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetch("/api/soul").then(r => r.json()).then((d: { content?: string }) => setHasSoul(!!d?.content)).catch(() => setHasSoul(false));
    fetch("/api/microsoft/status").then(r => r.json()).then((d: { connected?: boolean }) => setMsConnected(!!d?.connected)).catch(() => {});
    fetchTeamsStatus();
    fetchTelegramStatus();
  }, [fetchMessages, fetchTeamsStatus, fetchTelegramStatus]);

  useEffect(() => {
    if (!telegramStatus?.pending) return;
    const interval = setInterval(fetchTelegramStatus, 2000);
    return () => clearInterval(interval);
  }, [telegramStatus?.pending, fetchTelegramStatus]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (integrationMenuRef.current && !integrationMenuRef.current.contains(e.target as Node)) {
        setShowIntegrationMenu(false);
      }
      if (teamsMenuRef.current && !teamsMenuRef.current.contains(e.target as Node)) {
        setShowTeamsPanel(false);
      }
      if (telegramMenuRef.current && !telegramMenuRef.current.contains(e.target as Node)) {
        setShowTelegramPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpenTeamsPanel = useCallback(async () => {
    setShowTeamsPanel(v => !v);
    if (!teamsChatList.length && !teamsChannelList.length && msConnected) {
      setIsLoadingTeamsChats(true);
      try {
        const res = await fetch("/api/brain/teams-options");
        if (res.ok) {
          const data = await res.json() as { chats: TeamsChat[]; channels: TeamsChannel[] };
          setTeamsChatList(data.chats ?? []);
          setTeamsChannelList(data.channels ?? []);
        }
      } catch { /* ignore */ } finally {
        setIsLoadingTeamsChats(false);
      }
    }
  }, [teamsChatList.length, teamsChannelList.length, msConnected]);

  const handleTeamsConnect = useCallback(async (item: TeamsChat | TeamsChannel) => {
    setIsConnectingTeams(true);
    try {
      const body = item.kind === "channel"
        ? { type: "channel", channelId: item.id, teamId: item.teamId }
        : { type: "chat", chatId: item.id };
      const res = await fetch("/api/brain/teams-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchTeamsStatus();
        setShowTeamsPanel(false);
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? "Failed to connect");
      }
    } catch { /* ignore */ } finally {
      setIsConnectingTeams(false);
    }
  }, [fetchTeamsStatus]);

  const handleTeamsDisconnect = useCallback(async () => {
    setIsConnectingTeams(true);
    try {
      await fetch("/api/brain/teams-disconnect", { method: "DELETE" });
      await fetchTeamsStatus();
    } catch { /* ignore */ } finally {
      setIsConnectingTeams(false);
    }
  }, [fetchTeamsStatus]);

  const handleTelegramConnect = useCallback(async () => {
    if (!telegramToken.trim()) return;
    setIsTelegramConnecting(true);
    try {
      const res = await fetch("/api/brain/telegram-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramToken.trim() }),
      });
      const data = await res.json() as TelegramStatus & { error?: string };
      if (!res.ok) {
        alert(data.error ?? "Failed to connect");
        return;
      }
      setTelegramToken("");
      await fetchTelegramStatus();
    } catch { /* ignore */ } finally {
      setIsTelegramConnecting(false);
    }
  }, [telegramToken, fetchTelegramStatus]);

  const handleTelegramDisconnect = useCallback(async () => {
    setIsTelegramConnecting(true);
    try {
      await fetch("/api/brain/telegram-disconnect", { method: "POST" });
      await fetchTelegramStatus();
    } catch { /* ignore */ } finally {
      setIsTelegramConnecting(false);
    }
  }, [fetchTelegramStatus]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    let content = text.trim();
    if (selectedIntegrations.size > 0) {
      const labels = MS_INTEGRATIONS
        .filter(i => selectedIntegrations.has(i.key))
        .map(i => i.label)
        .join(", ");
      content = `[Use my connected Microsoft integrations: ${labels}]\n\n${content}`;
    }
    const userMsg: BrainMsg = {
      id: Date.now(),
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setAllMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreamText("");
    setActiveTools([]);
    setIsStreaming(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const res = await fetch("/api/brain/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let sseBuffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split("\n");
        sseBuffer = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            if ("content" in event) {
              accumulated += event.content;
              setStreamText(accumulated);
            } else if ("tool" in event && event.status === "running") {
              setActiveTools((prev) => [...prev, { name: event.tool, status: "running" }]);
            } else if ("tool" in event && event.status === "done") {
              setActiveTools((prev) =>
                prev.map((t) =>
                  t.name === event.tool && t.status === "running"
                    ? { ...t, status: "done", result: event.result ?? event.summary }
                    : t
                )
              );
            } else if ("done" in event) {
              if (accumulated) {
                const assistantMsg: BrainMsg = {
                  id: Date.now() + 1,
                  role: "assistant",
                  content: accumulated,
                  createdAt: new Date().toISOString(),
                };
                setAllMessages((prev) => [...prev, assistantMsg]);
                setStreamText("");
              }
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (err: unknown) {
      const errMsg: BrainMsg = {
        id: Date.now() + 2,
        role: "assistant",
        content: `Something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`,
        createdAt: new Date().toISOString(),
      };
      setAllMessages((prev) => [...prev, errMsg]);
      setStreamText("");
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, selectedIntegrations]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await fetch("/api/brain/messages", { method: "DELETE" });
      setAllMessages([]);
      setActiveTools([]);
      setStreamText("");
    } finally {
      setIsClearing(false);
    }
  };

  const displayItems = toDisplayItems(allMessages);
  const allEmpty = displayItems.length === 0 && !isStreaming;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100vh-2rem)] -m-4 md:-m-8">
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-card/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center shadow-lg shadow-[#0078d4]/20">
            <BrainCircuit size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">MateOS Brain</h1>
            <p className="text-xs text-muted-foreground">AI command center — talk to me in plain English</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
            hasSoul
              ? "bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#0078d4]/20 dark:text-[#5ea5e0]"
              : "bg-muted text-muted-foreground"
          )}>
            <Sparkles size={11} />
            Soul {hasSoul ? "active" : "not loaded"}
          </div>

          {/* Teams Channel Button */}
          <div className="relative" ref={teamsMenuRef}>
            <button
              onClick={handleOpenTeamsPanel}
              title="Connect Brain to a Teams chat"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border",
                teamsStatus?.connected
                  ? "bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/15 dark:text-green-400"
                  : "bg-muted/50 text-muted-foreground border-border hover:text-[#0078d4] hover:border-[#0078d4]/30"
              )}
            >
              <img src="https://img.icons8.com/fluency/48/microsoft-teams-2019.png" alt="Teams" className="w-3.5 h-3.5" />
              {teamsStatus?.connected ? (
                <>
                  <Wifi size={10} />
                  <span className="hidden sm:inline max-w-[100px] truncate">{teamsStatus.chatName ?? "Connected"}</span>
                </>
              ) : (
                <>
                  <WifiOff size={10} />
                  <span className="hidden sm:inline">Teams</span>
                </>
              )}
              {showTeamsPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>

            {showTeamsPanel && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 rounded-2xl border bg-popover shadow-xl shadow-black/10 overflow-hidden">
                <div className="px-4 pt-3.5 pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <MessageSquareDot size={14} className="text-[#0078d4]" />
                    <p className="text-sm font-semibold">Brain on Teams</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Pick a Teams chat — the Brain will listen and respond there
                  </p>
                </div>

                {!msConnected ? (
                  <div className="px-4 py-4 text-center">
                    <p className="text-xs text-muted-foreground">Connect your Microsoft account first</p>
                  </div>
                ) : (
                  <>
                    {teamsStatus?.connected && (
                      <div className="px-4 py-3 bg-green-500/5 border-b flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-green-600 dark:text-green-400">Active</p>
                          <p className="text-[11px] text-muted-foreground truncate">{teamsStatus.chatName ?? teamsStatus.chatId}</p>
                        </div>
                        <button
                          onClick={handleTeamsDisconnect}
                          disabled={isConnectingTeams}
                          className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all disabled:opacity-40"
                        >
                          {isConnectingTeams ? <Loader2 size={11} className="animate-spin" /> : "Disconnect"}
                        </button>
                      </div>
                    )}

                    <div className="max-h-72 overflow-y-auto">
                      {isLoadingTeamsChats ? (
                        <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground">
                          <Loader2 size={13} className="animate-spin" />
                          Loading chats &amp; channels…
                        </div>
                      ) : teamsChatList.length === 0 && teamsChannelList.length === 0 ? (
                        <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                          No Teams chats or channels found
                        </div>
                      ) : (
                        <>
                          {teamsChatList.length > 0 && (
                            <>
                              <div className="px-4 py-2 sticky top-0 bg-popover border-b">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Direct Chats</p>
                              </div>
                              {teamsChatList.map(chat => {
                                const isActive = teamsStatus?.chatId === chat.id && teamsStatus?.type !== "channel";
                                return (
                                  <div key={chat.id} className={cn("flex items-center gap-3 px-4 py-2.5 border-b border-border/40", isActive && "bg-[#0078d4]/5")}>
                                    <div className="w-7 h-7 rounded-lg bg-[#0078d4]/10 flex items-center justify-center shrink-0">
                                      <img src="https://img.icons8.com/fluency/48/microsoft-teams-2019.png" alt="" className="w-4 h-4" />
                                    </div>
                                    <span className="flex-1 text-sm font-medium text-foreground truncate">{chat.name}</span>
                                    <button
                                      onClick={() => !isActive && handleTeamsConnect(chat)}
                                      disabled={isConnectingTeams || isActive}
                                      className={cn(
                                        "shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all disabled:opacity-40",
                                        isActive ? "bg-green-500/10 text-green-600 cursor-default" : "bg-[#0078d4] text-white hover:bg-[#006cbe]"
                                      )}
                                    >
                                      {isConnectingTeams && !isActive ? <Loader2 size={11} className="animate-spin" /> : isActive ? "Active ✓" : "Use this"}
                                    </button>
                                  </div>
                                );
                              })}
                            </>
                          )}

                          {teamsChannelList.length > 0 && (
                            <>
                              <div className="px-4 py-2 sticky top-0 bg-popover border-b">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Team Channels</p>
                              </div>
                              {teamsChannelList.map(ch => {
                                const isActive = teamsStatus?.chatId === ch.id && teamsStatus?.type === "channel";
                                return (
                                  <div key={`${ch.teamId}-${ch.id}`} className={cn("flex items-center gap-3 px-4 py-2.5 border-b border-border/40", isActive && "bg-[#0078d4]/5")}>
                                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                                      <img src="https://img.icons8.com/fluency/48/microsoft-teams-2019.png" alt="" className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-foreground truncate">{ch.name}</p>
                                      <p className="text-[10px] text-muted-foreground truncate">{ch.teamName}</p>
                                    </div>
                                    <button
                                      onClick={() => !isActive && handleTeamsConnect(ch)}
                                      disabled={isConnectingTeams || isActive}
                                      className={cn(
                                        "shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all disabled:opacity-40",
                                        isActive ? "bg-green-500/10 text-green-600 cursor-default" : "bg-[#0078d4] text-white hover:bg-[#006cbe]"
                                      )}
                                    >
                                      {isConnectingTeams && !isActive ? <Loader2 size={11} className="animate-spin" /> : isActive ? "Active ✓" : "Use this"}
                                    </button>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Telegram Button */}
          <div className="relative" ref={telegramMenuRef}>
            <button
              onClick={() => setShowTelegramPanel(v => !v)}
              title="Connect Brain to Telegram"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border",
                telegramStatus?.connected
                  ? "bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/15 dark:text-green-400"
                  : telegramStatus?.pending
                  ? "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse"
                  : "bg-muted/50 text-muted-foreground border-border hover:text-[#26A5E4] hover:border-[#26A5E4]/30"
              )}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.01 13.71l-2.945-.918c-.64-.203-.652-.64.135-.954l11.497-4.43c.533-.194 1.002.131.832.813z" />
              </svg>
              {telegramStatus?.connected ? (
                <>
                  <Wifi size={10} />
                  <span className="hidden sm:inline max-w-[100px] truncate">{telegramStatus.botName ?? "Connected"}</span>
                </>
              ) : telegramStatus?.pending ? (
                <>
                  <Loader2 size={10} className="animate-spin" />
                  <span className="hidden sm:inline">Waiting…</span>
                </>
              ) : (
                <span className="hidden sm:inline">Telegram</span>
              )}
              {showTelegramPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>

            {showTelegramPanel && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 rounded-2xl border bg-popover shadow-xl shadow-black/10 overflow-hidden">
                <div className="px-4 pt-3.5 pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#26A5E4]" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.01 13.71l-2.945-.918c-.64-.203-.652-.64.135-.954l11.497-4.43c.533-.194 1.002.131.832.813z" />
                    </svg>
                    <p className="text-sm font-semibold">Brain on Telegram</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Connect a Telegram bot — Brain will listen and reply there
                  </p>
                </div>

                {telegramStatus?.connected ? (
                  <div className="px-4 py-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-green-600 dark:text-green-400">Active</p>
                        <p className="text-[11px] text-muted-foreground">{telegramStatus.botName}</p>
                      </div>
                      <button
                        onClick={handleTelegramDisconnect}
                        disabled={isTelegramConnecting}
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all disabled:opacity-40"
                      >
                        {isTelegramConnecting ? <Loader2 size={11} className="animate-spin" /> : "Disconnect"}
                      </button>
                    </div>
                  </div>
                ) : telegramStatus?.pending ? (
                  <div className="px-4 py-4 space-y-3">
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                      <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">Bot ready — {telegramStatus.botName}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">Open Telegram, find your bot, and send any message to connect</p>
                      </div>
                    </div>
                    <button
                      onClick={handleTelegramDisconnect}
                      disabled={isTelegramConnecting}
                      className="w-full text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-red-500 transition-all disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="px-4 py-4 space-y-3">
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        Create a bot via <span className="font-semibold text-[#26A5E4]">@BotFather</span> in Telegram, then paste the token below
                      </p>
                      <input
                        type="text"
                        value={telegramToken}
                        onChange={e => setTelegramToken(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleTelegramConnect()}
                        placeholder="123456:ABC-DEF1234..."
                        className="w-full text-xs px-3 py-2 rounded-lg border bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-[#26A5E4]/50"
                      />
                    </div>
                    <button
                      onClick={handleTelegramConnect}
                      disabled={isTelegramConnecting || !telegramToken.trim()}
                      className="w-full text-xs font-semibold py-2 rounded-lg bg-[#26A5E4] text-white hover:bg-[#1a94d3] disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                    >
                      {isTelegramConnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                      Connect Bot
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleClear}
            disabled={isClearing || isStreaming || displayItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 disabled:opacity-40 transition-all"
          >
            {isClearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {allEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-8 py-8">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center mx-auto shadow-xl shadow-[#0078d4]/25">
                <BrainCircuit size={28} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold">I'm the Brain</h2>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-md">
                I control everything in MateOS. Ask me to manage meetings, route alerts, update {botName}'s personality, or just give you an overview. I take real actions — not just suggestions.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.text}
                  onClick={() => handleSend(p.text)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border bg-card hover:bg-muted/50 text-left text-sm font-medium transition-all hover:border-[#0078d4]/40 group"
                >
                  <span className="text-lg">{p.icon}</span>
                  <span className="text-foreground/80 group-hover:text-foreground">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {displayItems.map((item) => {
          if (item.kind === "user") {
            return (
              <div key={item.msg.id} className="flex gap-3 max-w-full flex-row-reverse ml-auto justify-start">
                <div className="rounded-2xl px-4 py-3 max-w-[80%] shadow-sm text-sm leading-relaxed whitespace-pre-wrap bg-primary text-primary-foreground">
                  {item.msg.content}
                </div>
              </div>
            );
          }

          if (item.kind === "tool") {
            const toolName = item.msg.toolName ?? "unknown";
            const result = item.msg.toolResult ?? item.msg.content;
            return (
              <div key={item.msg.id} className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-sm shadow mt-0.5">
                  B
                </div>
                <div className="flex-1">
                  <ToolCard name={toolName} status="done" result={result} />
                </div>
              </div>
            );
          }

          return (
            <div key={item.msg.id} className="flex gap-3 max-w-full">
              <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-sm shadow mt-0.5">
                B
              </div>
              <div className="rounded-2xl px-4 py-3 max-w-[80%] shadow-sm text-sm leading-relaxed whitespace-pre-wrap bg-card border">
                {item.msg.content}
              </div>
            </div>
          );
        })}

        {activeTools.length > 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-sm shadow mt-0.5">
              B
            </div>
            <div className="flex-1 space-y-1">
              {activeTools.map((tool, i) => (
                <ToolCard key={`${tool.name}-${i}`} name={tool.name} status={tool.status} result={tool.result} />
              ))}
            </div>
          </div>
        )}

        {streamText && (
          <div className="flex gap-3 max-w-full">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-sm shadow mt-0.5">
              B
            </div>
            <div className="rounded-2xl px-4 py-3 max-w-[80%] bg-card border shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
              {streamText}
              <span className="inline-block w-0.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded align-middle" />
            </div>
          </div>
        )}

        {isStreaming && !streamText && activeTools.length === 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-sm shadow mt-0.5">
              B
            </div>
            <div className="rounded-2xl px-4 py-3 bg-card border shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="px-5 py-4 border-t bg-card/40 shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Integration chips */}
          {selectedIntegrations.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {MS_INTEGRATIONS.filter(i => selectedIntegrations.has(i.key)).map(i => (
                <span key={i.key} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-[11px] font-medium bg-[#0078d4]/10 text-[#0078d4] border border-[#0078d4]/20">
                  <img src={i.icon} alt={i.label} className="w-3.5 h-3.5 rounded-sm" />
                  {i.label}
                  <button
                    onClick={() => setSelectedIntegrations(s => { const n = new Set(s); n.delete(i.key); return n; })}
                    className="ml-0.5 hover:text-[#005a9e] transition-colors"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* + Integration button */}
            <div className="relative shrink-0" ref={integrationMenuRef}>
              <button
                onClick={() => setShowIntegrationMenu(v => !v)}
                title="Connect integrations to Brain"
                className={cn(
                  "w-[42px] h-[42px] rounded-2xl border flex items-center justify-center transition-all",
                  showIntegrationMenu
                    ? "bg-[#0078d4] text-white border-[#0078d4] shadow-md shadow-[#0078d4]/20"
                    : "bg-background text-muted-foreground hover:text-[#0078d4] hover:border-[#0078d4]/40"
                )}
              >
                <Plus size={16} />
              </button>

              {showIntegrationMenu && (
                <div className="absolute bottom-[52px] left-0 z-50 w-60 rounded-2xl border bg-popover shadow-xl shadow-black/10 overflow-hidden">
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Connect to Brain
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Brain will read from these when you send
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {MS_INTEGRATIONS.map(integration => {
                      const connected = selectedIntegrations.has(integration.key);
                      return (
                        <div key={integration.key} className="flex items-center gap-2.5 px-4 py-3">
                          <img src={integration.icon} alt={integration.label} className="w-5 h-5 rounded-sm shrink-0" />
                          <span className="flex-1 text-sm font-medium text-foreground">{integration.label}</span>
                          <button
                            onClick={() => setSelectedIntegrations(s => {
                              const n = new Set(s);
                              if (n.has(integration.key)) n.delete(integration.key);
                              else n.add(integration.key);
                              return n;
                            })}
                            className={cn(
                              "shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all",
                              connected
                                ? "bg-green-500/10 text-green-600 hover:bg-red-500/10 hover:text-red-500"
                                : "bg-[#0078d4] text-white hover:bg-[#006cbe]"
                            )}
                          >
                            {connected ? "Connected ✓" : "Connect"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Tell me what to do — approve meetings, update ${botName}, route alerts…`}
                disabled={isStreaming}
                rows={1}
                className="w-full resize-none rounded-2xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078d4]/20 disabled:opacity-50 leading-relaxed"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
            </div>

            <div className="shrink-0">
              <button
                onClick={() => handleSend(input)}
                disabled={!input.trim() || isStreaming}
                className="w-[42px] h-[42px] rounded-2xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] text-white flex items-center justify-center shadow-lg shadow-[#0078d4]/20 disabled:opacity-40 hover:opacity-90 transition-all"
              >
                {isStreaming ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={17} />
                )}
              </button>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2 opacity-60">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
