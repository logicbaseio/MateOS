import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useDeleteOpenaiConversation,
  getListOpenaiConversationsQueryKey,
} from "@workspace/api-client-react";
import { useVoiceRecorder, useAudioPlayback } from "@workspace/integrations-openai-ai-react/audio";
import {
  Send,
  Mic,
  Plus,
  Trash2,
  Loader2,
  Square,
  Crown,
  Users,
  X,
  ChevronRight,
  Link2,
  ArrowLeftRight,
  Headphones,
  MessageSquare,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HumeVoiceChat } from "@/components/HumeVoiceChat";
import { useBotName, useBossName } from "@/hooks/use-preferences";

type Viewpoint = "boss" | "customer";

interface ConvoSummary {
  id: number;
  title: string;
  viewpoint: string;
  customerName?: string | null;
  linkedConvoId?: number | null;
  createdAt: string;
}

interface MsgItem {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  createdAt: string;
}

interface ConvoWithMessages extends ConvoSummary {
  messages: MsgItem[];
}

interface LinkedPairWithMessages {
  customerConvo: ConvoWithMessages;
  bossConvo: ConvoWithMessages;
}

async function fetchLinkedPair(id: number): Promise<LinkedPairWithMessages> {
  const res = await fetch(`/api/openai/linked-conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation");
  return res.json();
}

async function fetchConvo(id: number): Promise<ConvoWithMessages> {
  const res = await fetch(`/api/openai/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation");
  return res.json();
}

function AvatarBoss({ size = 8 }: { size?: number }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center text-white font-bold shadow",
        `w-${size} h-${size}`,
        size <= 6 ? "text-xs" : "text-sm"
      )}
      style={{ background: "linear-gradient(135deg,#f59e0b,#ea580c)" }}
    >
      S
    </div>
  );
}

function AssistantAvatar({ size = 8, color = "purple" }: { size?: number; color?: string }) {
  const bg =
    color === "teal"
      ? "linear-gradient(135deg,#14b8a6,#059669)"
      : "linear-gradient(135deg,#84cc16,#4d7c0f)";
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center text-white font-bold shadow",
        `w-${size} h-${size}`,
        size <= 6 ? "text-xs" : "text-sm"
      )}
      style={{ background: bg }}
    >
      Z
    </div>
  );
}

function AvatarCustomer({ name, size = 8 }: { name?: string | null; size?: number }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center text-white font-bold shadow",
        `w-${size} h-${size}`,
        size <= 6 ? "text-xs" : "text-sm"
      )}
      style={{ background: "linear-gradient(135deg,#14b8a6,#059669)" }}
    >
      {name ? name[0].toUpperCase() : "C"}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

interface ChatPanelProps {
  convoId: number;
  viewpoint: Viewpoint;
  customerName?: string | null;
  messages: MsgItem[];
  streamingContent: string;
  isStreaming: boolean;
  isRecording: boolean;
  voiceTranscript: string;
  onSend: (text: string) => void;
  onVoiceToggle: () => void;
  linkedHasUpdates?: boolean;
}

function ChatPanel({
  convoId,
  viewpoint,
  customerName,
  messages,
  streamingContent,
  isStreaming,
  isRecording,
  voiceTranscript,
  onSend,
  onVoiceToggle,
}: ChatPanelProps) {
  const botName = useBotName();
  const bossName = useBossName();
  const isCustomer = viewpoint === "customer";
  const [inputText, setInputText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim()) {
        onSend(inputText.trim());
        setInputText("");
      }
    }
  };

  return (
    <div className={cn("flex flex-col flex-1 min-w-0 border-r last:border-r-0")}>
      <div
        className={cn(
          "px-4 py-3 border-b flex items-center gap-2.5",
          isCustomer
            ? "bg-teal-50/80 dark:bg-teal-900/10"
            : "bg-[#0078d4]/5 dark:bg-[#0078d4]/5"
        )}
      >
        {isCustomer ? (
          <>
            <AvatarCustomer name={customerName} size={8} />
            <div>
              <p className="font-semibold text-sm leading-tight">
                {customerName || "Customer"} ↔ {botName}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                {botName} presents as human
              </p>
            </div>
          </>
        ) : (
          <>
            <AvatarBoss size={8} />
            <div>
              <p className="font-semibold text-sm leading-tight">{bossName} ↔ {botName}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Crown size={10} className="text-[#0078d4]" />
                Private — {botName} briefs you
              </p>
            </div>
          </>
        )}
        <div
          className={cn(
            "ml-auto text-xs px-2 py-0.5 rounded-full font-medium",
            isCustomer
              ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
              : "bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#0078d4]/20 dark:text-[#5ea5e0]"
          )}
        >
          {isCustomer ? "Customer view" : "Boss view"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm text-center">
              {isCustomer
                ? `${customerName || "The customer"} hasn't said anything yet. Type their message below.`
                : `Say something to ${botName} — she has the customer's full context.`}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={cn("flex gap-2.5 max-w-full", isUser ? "flex-row-reverse ml-auto" : "")}
            >
              {isUser ? (
                isCustomer ? (
                  <AvatarCustomer name={customerName} size={7} />
                ) : (
                  <AvatarBoss size={7} />
                )
              ) : (
                  <AssistantAvatar size={7} color={isCustomer ? "teal" : "purple"} />
              )}
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 max-w-[82%] shadow-sm text-sm leading-relaxed whitespace-pre-wrap",
                  isUser
                    ? isCustomer
                      ? "bg-teal-500 text-white"
                      : "bg-[#0078d4] text-white"
                    : "bg-muted dark:bg-muted/60"
                )}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {isStreaming && streamingContent && (
          <div className="flex gap-2.5 max-w-full">
            <AssistantAvatar size={7} color={isCustomer ? "teal" : "purple"} />
            <div className="rounded-2xl px-3.5 py-2.5 max-w-[82%] bg-muted dark:bg-muted/60 shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
              {streamingContent}
              <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 rounded align-middle" />
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && (
          <div className="flex gap-2.5">
            <AssistantAvatar size={7} color={isCustomer ? "teal" : "purple"} />
            <div className="rounded-2xl px-3.5 py-2.5 bg-muted dark:bg-muted/60 shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}

        {voiceTranscript && isStreaming && (
          <div className="flex gap-2.5 flex-row-reverse ml-auto max-w-full">
            {isCustomer ? <AvatarCustomer name={customerName} size={7} /> : <AvatarBoss size={7} />}
            <div
              className={cn(
                "rounded-2xl px-3.5 py-2.5 max-w-[82%] shadow-sm",
                isCustomer ? "bg-teal-500 text-white" : "bg-[#0078d4] text-white"
              )}
            >
              <p className="text-xs opacity-70 flex items-center gap-1 mb-1">
                <Headphones size={10} /> voice
              </p>
              <p className="text-sm italic leading-relaxed">{voiceTranscript}</p>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div
        className={cn(
          "px-4 py-3 border-t",
          isCustomer
            ? "bg-teal-50/30 dark:bg-teal-900/5"
            : "bg-[#0078d4]/5 dark:bg-[#0078d4]/5"
        )}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              isRecording
                ? "Recording… tap stop when done"
                : isCustomer
                ? `${customerName || "Customer"} says…`
                : `${bossName} says to ${botName}…`
            }
            disabled={isStreaming || isRecording}
            rows={1}
            className="flex-1 resize-none rounded-xl border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <button
            onClick={onVoiceToggle}
            disabled={isStreaming}
            className={cn(
              "shrink-0 p-2.5 rounded-xl transition-all",
              isRecording
                ? "bg-red-500 text-white animate-pulse"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {isRecording ? <Square size={18} /> : <Mic size={18} />}
          </button>
          <button
            onClick={() => {
              if (inputText.trim()) {
                onSend(inputText.trim());
                setInputText("");
              }
            }}
            disabled={!inputText.trim() || isStreaming || isRecording}
            className={cn(
              "shrink-0 p-2.5 rounded-xl text-white disabled:opacity-40 transition-all hover:opacity-90",
              isCustomer ? "bg-teal-600" : "bg-[#0078d4]"
            )}
          >
            {isStreaming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface VoicePair {
  customerConvoId: number;
  bossConvoId: number;
}

export default function Chat() {
  const queryClient = useQueryClient();
  const botName = useBotName();
  const bossName = useBossName();
  const [activeLinkedId, setActiveLinkedId] = useState<number | null>(null);
  const [activeSoloId, setActiveSoloId] = useState<number | null>(null);
  const [showHumeVoice, setShowHumeVoice] = useState(false);
  const [voicePair, setVoicePair] = useState<VoicePair | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newMode, setNewMode] = useState<"linked" | "solo_boss" | "solo_customer">("linked");
  const [newCustomerName, setNewCustomerName] = useState("");

  const [customerStreaming, setCustomerStreaming] = useState(false);
  const [customerStreamText, setCustomerStreamText] = useState("");
  const [customerRecording, setCustomerRecording] = useState(false);
  const [customerVoice, setCustomerVoice] = useState("");
  const [bossStreaming, setBossStreaming] = useState(false);
  const [bossStreamText, setBossStreamText] = useState("");
  const [bossRecording, setBossRecording] = useState(false);
  const [bossVoice, setBossVoice] = useState("");
  const [soloStreaming, setSoloStreaming] = useState(false);
  const [soloStreamText, setSoloStreamText] = useState("");
  const [soloRecording, setSoloRecording] = useState(false);
  const [soloVoice, setSoloVoice] = useState("");

  const workletUrl = `${import.meta.env.BASE_URL}audio-playback-worklet.js`;
  const audioPlayback = useAudioPlayback(workletUrl);
  const customerRecorder = useVoiceRecorder();
  const bossRecorder = useVoiceRecorder();
  const soloRecorder = useVoiceRecorder();

  const { data: conversationsList } = useListOpenaiConversations();
  const createConvo = useCreateOpenaiConversation();
  const deleteConvo = useDeleteOpenaiConversation();

  const { data: linkedPair, refetch: refetchLinked } = useQuery({
    queryKey: ["linked-pair", activeLinkedId],
    queryFn: () => fetchLinkedPair(activeLinkedId!),
    enabled: !!activeLinkedId,
    refetchInterval: false,
  });

  const { data: soloConvo, refetch: refetchSolo } = useQuery({
    queryKey: ["solo-convo", activeSoloId],
    queryFn: () => fetchConvo(activeSoloId!),
    enabled: !!activeSoloId,
    refetchInterval: false,
  });

  useEffect(() => {
    if (!voiceActive || !activeLinkedId) return;
    const interval = setInterval(() => {
      refetchLinked();
    }, 3000);
    return () => clearInterval(interval);
  }, [voiceActive, activeLinkedId, refetchLinked]);

  const startVoiceSession = useCallback(async () => {
    try {
      const res = await fetch("/api/openai/linked-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: "Voice Caller" }),
      });
      if (!res.ok) return;
      const pair = await res.json();
      const customerConvoId = pair.customerConvo.id as number;
      const bossConvoId = pair.bossConvo.id as number;
      await queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      setVoicePair({ customerConvoId, bossConvoId });
      setActiveLinkedId(customerConvoId);
      setActiveSoloId(null);
      setVoiceActive(true);
      setShowHumeVoice(false);
    } catch {}
  }, [queryClient]);

  const streamText = useCallback(
    async (
      convoId: number,
      content: string,
      onChunk: (c: string) => void,
      onDone: () => void,
      onError: (e: string) => void
    ) => {
      const response = await fetch(`/api/openai/conversations/${convoId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        onError("Failed to send");
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        onError("No stream");
        return;
      }
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) break;
              if (data.content) {
                acc += data.content;
                onChunk(acc);
              }
            } catch {}
          }
        }
      }
      onDone();
    },
    []
  );

  const handleCustomerSend = useCallback(
    async (text: string) => {
      if (!linkedPair || customerStreaming) return;
      setCustomerStreaming(true);
      setCustomerStreamText("");
      try {
        await streamText(
          linkedPair.customerConvo.id,
          text,
          setCustomerStreamText,
          () => {},
          console.error
        );
      } finally {
        setCustomerStreaming(false);
        setCustomerStreamText("");
        refetchLinked();
      }
    },
    [linkedPair, customerStreaming, streamText, refetchLinked]
  );

  const handleBossSend = useCallback(
    async (text: string) => {
      if (!linkedPair || bossStreaming) return;
      setBossStreaming(true);
      setBossStreamText("");
      try {
        await streamText(
          linkedPair.bossConvo.id,
          text,
          setBossStreamText,
          () => {},
          console.error
        );
      } finally {
        setBossStreaming(false);
        setBossStreamText("");
        refetchLinked();
      }
    },
    [linkedPair, bossStreaming, streamText, refetchLinked]
  );

  const handleSoloSend = useCallback(
    async (text: string) => {
      if (!activeSoloId || soloStreaming) return;
      setSoloStreaming(true);
      setSoloStreamText("");
      try {
        await streamText(activeSoloId, text, setSoloStreamText, () => {}, console.error);
      } finally {
        setSoloStreaming(false);
        setSoloStreamText("");
        refetchSolo();
      }
    },
    [activeSoloId, soloStreaming, streamText, refetchSolo]
  );

  const handleCreateConversation = async () => {
    if (newMode === "linked") {
      const res = await fetch("/api/openai/linked-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: newCustomerName || "Guest" }),
      });
      if (res.ok) {
        const pair = await res.json();
        await queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        setActiveLinkedId(pair.customerConvo.id);
        setActiveSoloId(null);
      }
    } else {
      const viewpoint = newMode === "solo_boss" ? "boss" : "customer";
      const result = await createConvo.mutateAsync({
        data: {
          title: newMode === "solo_boss" ? `${bossName} — ${botName} chat` : `${newCustomerName || "Guest"} inquiry`,
          viewpoint,
          customerName: newCustomerName || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      setActiveSoloId(result.id);
      setActiveLinkedId(null);
    }
    setShowNewModal(false);
    setNewCustomerName("");
    setNewMode("linked");
  };

  const handleDeleteConversation = async (id: number) => {
    const convo = conversationsList?.find((c) => c.id === id);
    await deleteConvo.mutateAsync({ id });
    if (convo?.linkedConvoId) {
      await deleteConvo.mutateAsync({ id: convo.linkedConvoId }).catch(() => {});
    }
    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    if (activeLinkedId === id || activeLinkedId === convo?.linkedConvoId) {
      setActiveLinkedId(null);
    }
    if (activeSoloId === id) setActiveSoloId(null);
  };

  const linkedConvoIds = new Set<number>();
  conversationsList?.forEach((c) => {
    if (c.linkedConvoId) {
      linkedConvoIds.add(c.id);
      linkedConvoIds.add(c.linkedConvoId);
    }
  });

  const groupedList = conversationsList
    ? [
        ...conversationsList.filter(
          (c) => c.linkedConvoId && (c as any).viewpoint === "customer"
        ),
        ...conversationsList.filter((c) => !c.linkedConvoId),
      ]
    : [];

  const isLinkedEntry = (c: ConvoSummary) => !!(c.linkedConvoId);

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-[calc(100vh-2rem)] -m-4 md:-m-8">
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xl">Start a Conversation</h3>
              <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-2">
              {[
                {
                  key: "linked",
                  icon: <ArrowLeftRight size={18} />,
                  label: "Two-way relay",
                  desc: `Live split view — ${botName} talks to a customer AND briefs ${bossName} simultaneously, with full cross-context`,
                  color: "from-teal-400 to-emerald-500",
                  badge: "⭐ Recommended",
                },
                {
                  key: "solo_boss",
                  icon: <Crown size={16} />,
                  label: `${bossName}'s private chat`,
                  desc: `Just ${bossName} checking in with ${botName}`,
                  color: "from-[#0078d4] to-[#005a9e]",
                  badge: null,
                },
                {
                  key: "solo_customer",
                  icon: <Users size={16} />,
                  label: "Customer simulation",
                  desc: "See exactly what a client experiences",
                  color: "from-teal-400 to-emerald-600",
                  badge: null,
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setNewMode(opt.key as typeof newMode)}
                  className={cn(
                    "w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all",
                    newMode === opt.key
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div
                    className={cn(
                      "shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-white mt-0.5",
                      opt.color
                    )}
                  >
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{opt.label}</span>
                      {opt.badge && (
                        <span className="text-xs text-primary font-medium">{opt.badge}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opt.desc}</p>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 w-4 h-4 rounded-full border-2 mt-1",
                      newMode === opt.key ? "border-primary bg-primary" : "border-muted-foreground/30"
                    )}
                  />
                </button>
              ))}
            </div>

            {(newMode === "linked" || newMode === "solo_customer") && (
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Customer name <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateConversation()}
                  placeholder="e.g. Ahmed Khan"
                  className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}

            <button
              onClick={handleCreateConversation}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              Start Conversation
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="w-72 border-r bg-card/50 flex flex-col shrink-0 hidden md:flex">
        <div className="p-4 border-b">
          <button
            onClick={() => setShowNewModal(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-medium"
          >
            <Plus size={18} />
            New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {groupedList.map((convo) => {
            const isLinked = isLinkedEntry(convo);
            const isC = (convo as any).viewpoint === "customer";
            const activeId = isLinked ? convo.id : convo.id;
            const isActive = isLinked
              ? activeLinkedId === convo.id || activeLinkedId === convo.linkedConvoId
              : activeSoloId === convo.id;

            return (
              <div
                key={convo.id}
                className={cn(
                  "group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => {
                  if (isLinked) {
                    setActiveLinkedId(convo.id);
                    setActiveSoloId(null);
                  } else {
                    setActiveSoloId(convo.id);
                    setActiveLinkedId(null);
                  }
                }}
              >
                {isLinked ? (
                  <div className="shrink-0 flex items-center">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold">
                      C
                    </div>
                    <ArrowLeftRight size={10} className="mx-0.5 opacity-50" />
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white text-xs font-bold">
                      S
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold",
                      isC
                        ? "bg-gradient-to-br from-teal-400 to-emerald-600"
                        : "bg-gradient-to-br from-[#0078d4] to-[#005a9e]"
                    )}
                  >
                    {isC ? "C" : "S"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">{convo.title}</p>
                  <p className="text-xs opacity-50">
                    {isLinked ? "Two-way relay" : isC ? "Customer view" : "Boss view"}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(convo.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-destructive/70 hover:text-destructive transition-opacity"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}

          {(!conversationsList || conversationsList.length === 0) && (
            <div className="text-center text-muted-foreground text-sm py-8 px-4">
              No conversations yet
            </div>
          )}
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={startVoiceSession}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all",
              voiceActive
                ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <div className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
              <Phone size={12} className="text-white" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm truncate">{botName} Voice Call</p>
              <p className="text-xs opacity-60">
                {voiceActive ? "Call in progress…" : "Live AI voice conversation"}
              </p>
            </div>
          </button>
        </div>

        <div className="p-4 border-t space-y-2.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">How it works</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <ArrowLeftRight size={12} className="shrink-0 mt-0.5 text-primary" />
              <span><strong className="text-foreground">Two-way relay</strong>: {botName} sees both sides and relays between customer and {bossName} in real time</span>
            </div>
            <div className="flex items-start gap-2">
              <Crown size={12} className="shrink-0 mt-0.5 text-[#0078d4]" />
              <span><strong className="text-foreground">Boss view</strong>: {bossName} instructs {botName} privately</span>
            </div>
            <div className="flex items-start gap-2">
              <Users size={12} className="shrink-0 mt-0.5 text-teal-500" />
              <span><strong className="text-foreground">Customer view</strong>: See what clients experience</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {showHumeVoice ? (
          <div className="flex-1 flex items-center justify-center p-6 bg-muted/20">
            <div className="w-full max-w-lg h-[calc(100vh-10rem)]">
              <HumeVoiceChat assistantName={botName} onClose={() => setShowHumeVoice(false)} />
            </div>
          </div>
        ) : activeLinkedId && linkedPair ? (
          <div className="relative flex-1 flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b bg-card/30 flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <AvatarCustomer name={linkedPair.customerConvo.customerName} size={7} />
                <ArrowLeftRight size={14} className="text-muted-foreground" />
                <AssistantAvatar size={7} color="purple" />
                <ArrowLeftRight size={14} className="text-muted-foreground" />
                <AvatarBoss size={7} />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {linkedPair.customerConvo.customerName || "Customer"} ↔ {botName} ↔ {bossName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {voiceActive
                    ? `Live voice call — transcripts appear in real time. Type in Boss view to send ${botName} instructions.`
                    : `${botName} knows what's happening on both sides — she relays and mediates in real time`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-xs text-primary font-medium bg-primary/10 px-3 py-1.5 rounded-full">
                <Link2 size={12} />
                {voiceActive ? "Voice Relay" : "Live Relay"}
              </div>
            </div>

            {voiceActive && voicePair && (
              <div className="absolute bottom-4 right-4 z-30 w-64">
                <HumeVoiceChat
                  compact
                  assistantName={botName}
                  customerConvoId={voicePair.customerConvoId}
                  bossConvoId={voicePair.bossConvoId}
                  onCallEnd={() => {
                    setVoiceActive(false);
                    setVoicePair(null);
                    refetchLinked();
                    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
                  }}
                />
              </div>
            )}

            <div className="flex-1 flex overflow-hidden">
              <ChatPanel
                convoId={linkedPair.customerConvo.id}
                viewpoint="customer"
                customerName={linkedPair.customerConvo.customerName}
                messages={linkedPair.customerConvo.messages}
                streamingContent={customerStreamText}
                isStreaming={customerStreaming}
                isRecording={customerRecording}
                voiceTranscript={customerVoice}
                onSend={handleCustomerSend}
                onVoiceToggle={async () => {
                  if (customerRecording) {
                    setCustomerRecording(false);
                    const blob = await customerRecorder.stopRecording();
                    if (!blob || !linkedPair) return;
                    setCustomerStreaming(true);
                    try {
                      await audioPlayback.init();
                      const ab = await blob.arrayBuffer();
                      const b64 = btoa(new Uint8Array(ab).reduce((d, b) => d + String.fromCharCode(b), ""));
                      const res = await fetch(`/api/openai/conversations/${linkedPair.customerConvo.id}/voice-messages`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ audio: b64 }),
                      });
                      const reader = res.body?.getReader();
                      if (!reader) return;
                      const dec = new TextDecoder();
                      let transcript = "";
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        for (const line of dec.decode(value, { stream: true }).split("\n")) {
                          if (line.startsWith("data: ")) {
                            try {
                              const d = JSON.parse(line.slice(6));
                              if (d.done) { audioPlayback.signalComplete(); break; }
                              if (d.type === "transcript") { transcript += d.data; setCustomerStreamText(transcript); }
                              if (d.type === "audio") audioPlayback.pushAudio(d.data);
                              if (d.type === "user_transcript") setCustomerVoice(d.data);
                            } catch {}
                          }
                        }
                      }
                    } finally {
                      setCustomerStreaming(false);
                      setCustomerStreamText("");
                      setCustomerVoice("");
                      refetchLinked();
                    }
                  } else {
                    setCustomerRecording(true);
                    try {
                      await customerRecorder.startRecording();
                    } catch {
                      setCustomerRecording(false);
                    }
                  }
                }}
              />
              <ChatPanel
                convoId={linkedPair.bossConvo.id}
                viewpoint="boss"
                customerName={linkedPair.bossConvo.customerName}
                messages={linkedPair.bossConvo.messages}
                streamingContent={bossStreamText}
                isStreaming={bossStreaming}
                isRecording={bossRecording}
                voiceTranscript={bossVoice}
                onSend={handleBossSend}
                onVoiceToggle={async () => {
                  if (bossRecording) {
                    setBossRecording(false);
                    const blob = await bossRecorder.stopRecording();
                    if (!blob || !linkedPair) return;
                    setBossStreaming(true);
                    try {
                      await audioPlayback.init();
                      const ab = await blob.arrayBuffer();
                      const b64 = btoa(new Uint8Array(ab).reduce((d, b) => d + String.fromCharCode(b), ""));
                      const res = await fetch(`/api/openai/conversations/${linkedPair.bossConvo.id}/voice-messages`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ audio: b64 }),
                      });
                      const reader = res.body?.getReader();
                      if (!reader) return;
                      const dec = new TextDecoder();
                      let transcript = "";
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        for (const line of dec.decode(value, { stream: true }).split("\n")) {
                          if (line.startsWith("data: ")) {
                            try {
                              const d = JSON.parse(line.slice(6));
                              if (d.done) { audioPlayback.signalComplete(); break; }
                              if (d.type === "transcript") { transcript += d.data; setBossStreamText(transcript); }
                              if (d.type === "audio") audioPlayback.pushAudio(d.data);
                              if (d.type === "user_transcript") setBossVoice(d.data);
                            } catch {}
                          }
                        }
                      }
                    } finally {
                      setBossStreaming(false);
                      setBossStreamText("");
                      setBossVoice("");
                      refetchLinked();
                    }
                  } else {
                    setBossRecording(true);
                    try {
                      await bossRecorder.startRecording();
                    } catch {
                      setBossRecording(false);
                    }
                  }
                }}
              />
            </div>
          </div>
        ) : activeSoloId && soloConvo ? (
          <ChatPanel
            convoId={activeSoloId}
            viewpoint={(soloConvo.viewpoint as Viewpoint) || "boss"}
            customerName={soloConvo.customerName}
            messages={soloConvo.messages}
            streamingContent={soloStreamText}
            isStreaming={soloStreaming}
            isRecording={soloRecording}
            voiceTranscript={soloVoice}
            onSend={handleSoloSend}
            onVoiceToggle={async () => {
              if (soloRecording) {
                setSoloRecording(false);
                const blob = await soloRecorder.stopRecording();
                if (!blob || !activeSoloId) return;
                setSoloStreaming(true);
                try {
                  await audioPlayback.init();
                  const ab = await blob.arrayBuffer();
                  const b64 = btoa(new Uint8Array(ab).reduce((d, b) => d + String.fromCharCode(b), ""));
                  const res = await fetch(`/api/openai/conversations/${activeSoloId}/voice-messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ audio: b64 }),
                  });
                  const reader = res.body?.getReader();
                  if (!reader) return;
                  const dec = new TextDecoder();
                  let transcript = "";
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    for (const line of dec.decode(value, { stream: true }).split("\n")) {
                      if (line.startsWith("data: ")) {
                        try {
                          const d = JSON.parse(line.slice(6));
                          if (d.done) { audioPlayback.signalComplete(); break; }
                          if (d.type === "transcript") { transcript += d.data; setSoloStreamText(transcript); }
                          if (d.type === "audio") audioPlayback.pushAudio(d.data);
                          if (d.type === "user_transcript") setSoloVoice(d.data);
                        } catch {}
                      }
                    }
                  }
                } finally {
                  setSoloStreaming(false);
                  setSoloStreamText("");
                  setSoloVoice("");
                  refetchSolo();
                }
              } else {
                setSoloRecording(true);
                try {
                  await soloRecorder.startRecording();
                } catch {
                  setSoloRecording(false);
                }
              }
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center space-y-6 max-w-lg">
              <div className="flex items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-teal-400/25">C</div>
                <ArrowLeftRight size={24} className="text-muted-foreground/40" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0078d4] to-[#005a9e] flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-[#0078d4]/25">Z</div>
                <ArrowLeftRight size={24} className="text-muted-foreground/40" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#004e8c] to-[#002d62] flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-[#004e8c]/25">S</div>
              </div>

              <div>
                <h2 className="text-2xl font-bold mb-2">Live Two-Way Relay</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {botName} sits in the middle — handling the customer conversation on one side and briefing {bossName} on the other.
                  She sees everything and relays seamlessly, like a real human assistant would.
                </p>
              </div>

              <div className="p-4 rounded-xl border bg-muted/30 text-left space-y-3">
                <p className="font-semibold text-sm">Example flow:</p>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>🟢 <strong>Customer</strong> → {botName}: "I need to meet {bossName} about Q2 budget"</p>
                  <p>🟣 <strong>{botName}</strong> → Customer: "Sure! What days work for you this week?"</p>
                  <p>🟡 <strong>{botName}</strong> → {bossName}: "Ahmed wants budget review — Thursday evening ok?"</p>
                  <p>🟠 <strong>{bossName}</strong> → {botName}: "Yes, Thursday 7pm works"</p>
                  <p>🟣 <strong>{botName}</strong> → Customer: "Great news — Thursday at 7pm is confirmed!"</p>
                </div>
              </div>

              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold shadow-lg shadow-primary/20"
              >
                <Plus size={18} />
                Start Two-Way Conversation
              </button>
            </div>
          </div>
        ) }
      </div>
    </div>
  );
}
