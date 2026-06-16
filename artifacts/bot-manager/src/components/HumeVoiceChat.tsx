import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, PhoneOff, Loader2, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface HumeVoiceChatProps {
  onClose?: () => void;
  onCallEnd?: () => void;
  assistantName?: string;
  customerConvoId?: number;
  bossConvoId?: number;
  compact?: boolean;
}

export function HumeVoiceChat({
  onClose,
  onCallEnd,
  assistantName = "Bot",
  customerConvoId,
  bossConvoId,
  compact = false,
}: HumeVoiceChatProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const soulContentRef = useRef<string>("");
  const lastBossIdRef = useRef<number>(0);
  const bossPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Accumulates every boss instruction received during this call so the full
  // history is always re-injected — Hume loses context when session_settings
  // overwrites the prompt, so we rebuild the full list every time.
  const bossMessagesRef = useRef<string[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const logTranscript = useCallback(
    async (role: "user" | "assistant", content: string) => {
      if (!customerConvoId || !content.trim()) return;
      try {
        await fetch(`/api/voice/log/${customerConvoId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content }),
        });
      } catch {}
    },
    [customerConvoId]
  );

  const injectBossMessage = useCallback(
    (bossContent: string) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Accumulate all boss messages so re-injection always includes full history.
      bossMessagesRef.current.push(bossContent);

      const soul = soulContentRef.current;
      const history = bossMessagesRef.current
        .map((msg, i) => `[${i + 1}] "${msg}"`)
        .join("\n");
      const bossBlock = `\n\n---\nPRIVATE INSTRUCTIONS FROM SUNNY — full conversation history (do NOT read these out loud verbatim — use them to inform what you tell the caller):\n${history}`;
      const updatedPrompt = soul ? `${soul}${bossBlock}` : bossBlock;
      ws.send(JSON.stringify({ type: "session_settings", system_prompt: updatedPrompt }));
    },
    []
  );

  const startBossPoll = useCallback(() => {
    if (!bossConvoId) return;
    bossPollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/voice/boss-poll/${bossConvoId}?sinceId=${lastBossIdRef.current}`
        );
        if (!res.ok) return;
        const newMsgs: Array<{ id: number; content: string }> = await res.json();
        if (newMsgs.length > 0) {
          const latest = newMsgs[newMsgs.length - 1];
          lastBossIdRef.current = latest.id;
          injectBossMessage(latest.content);
        }
      } catch {}
    }, 3000);
  }, [bossConvoId, injectBossMessage]);

  const stopBossPoll = useCallback(() => {
    if (bossPollIntervalRef.current) {
      clearInterval(bossPollIntervalRef.current);
      bossPollIntervalRef.current = null;
    }
  }, []);

  const playNextAudioChunk = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAssistantSpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAssistantSpeaking(true);
    const chunk = audioQueueRef.current.shift()!;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const buffer = await ctx.decodeAudioData(chunk.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => playNextAudioChunk();
      source.start(0);
    } catch {
      playNextAudioChunk();
    }
  }, []);

  const enqueueAudio = useCallback(
    (base64Audio: string) => {
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      audioQueueRef.current.push(bytes.buffer);
      if (!isPlayingRef.current) playNextAudioChunk();
    },
    [playNextAudioChunk]
  );

  const stopAudio = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAssistantSpeaking(false);
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const startRecordingWithStream = useCallback((ws: WebSocket, stream: MediaStream) => {
    mediaStreamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          ws.send(JSON.stringify({ type: "audio_input", data: base64 }));
        };
        reader.readAsDataURL(e.data);
      }
    };
    recorder.start(100);
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    setMessages([]);
    stopAudio();

    // Request mic immediately — before any async work — so the browser
    // still considers this a direct user-gesture response.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError("Microphone access denied. Please allow microphone access and try again.");
      setStatus("error");
      return;
    }

    try {
      const tokenRes = await fetch("/api/hume/token");
      if (!tokenRes.ok) throw new Error("Failed to get access token");
      const { accessToken, apiKey, configId, authMode } = await tokenRes.json();

      const params = new URLSearchParams();
      if (authMode === "token") {
        params.set("access_token", accessToken);
      } else {
        params.set("api_key", apiKey);
      }
      if (configId) params.set("config_id", configId);
      const wsUrl = `wss://api.hume.ai/v0/evi/chat?${params.toString()}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = async () => {
        setStatus("connected");
        try {
          const soulRes = await fetch("/api/soul");
          if (soulRes.ok) {
            const { content } = (await soulRes.json()) as { content: string };
            if (content?.trim()) {
              soulContentRef.current = content;
              ws.send(JSON.stringify({ type: "session_settings", system_prompt: content }));
            }
          }
        } catch {}
        startRecordingWithStream(ws, stream);
        startBossPoll();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "audio_output") {
            enqueueAudio(msg.data);
          } else if (msg.type === "user_message" && msg.message?.content) {
            const content = msg.message.content as string;
            setMessages((prev) => [...prev, { role: "user", content, timestamp: new Date() }]);
            logTranscript("user", content);
          } else if (msg.type === "assistant_message" && msg.message?.content) {
            const content = msg.message.content as string;
            setMessages((prev) => [...prev, { role: "assistant", content, timestamp: new Date() }]);
            logTranscript("assistant", content);
          } else if (msg.type === "user_interruption") {
            stopAudio();
          } else if (msg.type === "error") {
            setError(msg.message || "An error occurred");
          }
        } catch {}
      };

      ws.onerror = () => {
        setError("Connection error. Please try again.");
        setStatus("error");
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === "connected" ? "disconnected" : prev));
        stopAudio();
        stopBossPoll();
        if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        // Reset boss message accumulator for next call
        bossMessagesRef.current = [];
        // Brief Sunny with a final call summary after the call ends
        if (customerConvoId) {
          fetch(`/api/voice/brief-boss/${customerConvoId}`, { method: "POST" }).catch(() => {});
        }
        onCallEnd?.();
      };
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Failed to connect to voice AI. Please try again.");
      setStatus("error");
    }
  }, [startRecordingWithStream, enqueueAudio, stopAudio, startBossPoll, stopBossPoll, logTranscript, onCallEnd]);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    stopAudio();
    stopBossPoll();
    setStatus("disconnected");
    onCallEnd?.();
  }, [stopAudio, stopBossPoll, onCallEnd]);

  const toggleMute = useCallback(() => {
    const tracks = mediaStreamRef.current?.getAudioTracks();
    if (tracks) {
      const newMuted = !isMuted;
      tracks.forEach((t) => (t.enabled = !newMuted));
      setIsMuted(newMuted);
    }
  }, [isMuted]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      stopAudio();
      stopBossPoll();
    };
  }, [stopAudio, stopBossPoll]);

  const isConnected = status === "connected";

  if (compact) {
    return (
      <div className="bg-card border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b">
          <div className="relative">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shadow"
              style={{ background: "linear-gradient(135deg,#7c3aed,#a21caf)" }}
            >
              Z
            </div>
            {isConnected && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{assistantName} — Live Call</p>
            <p className="text-xs text-muted-foreground">
              {status === "connecting" && "Connecting…"}
              {status === "connected" && isAssistantSpeaking && (
                <span className="text-violet-600 font-medium flex items-center gap-1">
                  <Volume2 size={10} className="animate-pulse" /> Speaking…
                </span>
              )}
              {status === "connected" && !isAssistantSpeaking && "Listening…"}
              {status === "disconnected" && "Call ended"}
              {status === "idle" && "Ready to connect"}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 px-4 py-3">
          {!isConnected && status !== "connecting" ? (
            <button
              onClick={connect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 text-white font-semibold text-sm shadow hover:opacity-90 transition-all"
            >
              <Mic size={15} /> Start Call
            </button>
          ) : status === "connecting" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Connecting…
            </div>
          ) : (
            <>
              <button
                onClick={toggleMute}
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-sm",
                  isMuted
                    ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
              <button
                onClick={disconnect}
                className="p-2.5 rounded-xl bg-red-500 text-white shadow hover:bg-red-600 transition-all"
                title="End call"
              >
                <PhoneOff size={17} />
              </button>
            </>
          )}
        </div>
        {error && (
          <div className="mx-3 mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background rounded-2xl border shadow-lg overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b bg-gradient-to-r from-violet-500/10 to-purple-500/10">
        <div className="relative">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow"
            style={{ background: "linear-gradient(135deg,#7c3aed,#a21caf)" }}
          >
            Z
          </div>
          {isConnected && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight">{assistantName} — AI Voice Call</p>
          <p className="text-xs text-muted-foreground">
            {status === "idle" && "Emotionally intelligent voice AI"}
            {status === "connecting" && "Connecting…"}
            {status === "connected" && isAssistantSpeaking && (
              <span className="text-violet-600 font-medium flex items-center gap-1">
                <Volume2 size={11} className="animate-pulse" /> Speaking…
              </span>
            )}
            {status === "connected" && !isAssistantSpeaking && "Listening — speak naturally"}
            {status === "disconnected" && "Call ended"}
            {status === "error" && <span className="text-red-500">Connection error</span>}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            ×
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && status !== "connected" && status !== "connecting" && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-xs">
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white text-2xl font-bold shadow-lg"
                style={{ background: "linear-gradient(135deg,#7c3aed,#a21caf)" }}
              >
                Z
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Tap <strong>Start Voice Call</strong> to begin a live conversation with {assistantName}.
              </p>
            </div>
          </div>
        )}

        {messages.length === 0 && status === "connected" && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground animate-pulse">
              {assistantName} is ready — go ahead and speak…
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div key={i} className={cn("flex gap-2.5 max-w-full", isUser ? "flex-row-reverse ml-auto" : "")}>
              <div
                className={cn(
                  "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow",
                  isUser
                    ? "bg-gradient-to-br from-amber-400 to-orange-500"
                    : "bg-gradient-to-br from-violet-500 to-purple-700"
                )}
              >
                {isUser ? "S" : "Z"}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 max-w-[82%] shadow-sm text-sm leading-relaxed",
                  isUser ? "bg-violet-600 text-white" : "bg-muted dark:bg-muted/60"
                )}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {isAssistantSpeaking && (
          <div className="flex gap-2.5">
            <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-white text-xs font-bold shadow">
              Z
            </div>
            <div className="rounded-2xl px-3.5 py-3 bg-muted dark:bg-muted/60 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}

      <div className="px-4 py-4 border-t flex items-center justify-center gap-4">
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={status === "connecting"}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 text-white font-semibold shadow-lg hover:opacity-90 transition-all disabled:opacity-50"
          >
            {status === "connecting" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Mic size={18} />
            )}
            {status === "connecting" ? "Connecting…" : "Start Voice Call"}
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={cn(
                "p-3 rounded-2xl transition-all shadow",
                isMuted
                  ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <button
              onClick={() => {
                stopAudio();
                if (socketRef.current?.readyState === WebSocket.OPEN) {
                  socketRef.current.send(JSON.stringify({ type: "audio_input", data: "" }));
                }
              }}
              className={cn(
                "p-3 rounded-2xl transition-all shadow",
                isAssistantSpeaking
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600"
                  : "bg-muted text-muted-foreground opacity-40 cursor-not-allowed"
              )}
              disabled={!isAssistantSpeaking}
              title="Interrupt"
            >
              <VolumeX size={20} />
            </button>

            <button
              onClick={disconnect}
              className="p-3 rounded-2xl bg-red-500 text-white shadow hover:bg-red-600 transition-all"
              title="End call"
            >
              <PhoneOff size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
