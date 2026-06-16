import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useBotName, useBossName } from "@/hooks/use-preferences";
import {
  Send,
  Hash,
  Phone,
  Users,
  Headphones,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  Check,
  Loader2,
  X,
  ExternalLink,
  Wifi,
  WifiOff,
  ChevronRight,
  Clock,
  UserCircle2,
  ChevronDown,
  Pencil,
  PhoneCall,
  PhoneOff,
  Mic,
  Search,
  Play,
  Square,
  Volume2,
  ChevronUp,
  Cpu,
  Brain,
  Link2,
  Link2Off,
  Key,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelMeta {
  botUsername?: string;
  channelId?: string;
  applicationId?: string;
  guildId?: string;
  phoneNumberId?: string;
  connectorLabel?: string;
  botName?: string;
}

interface ChannelStatus {
  channelType: string;
  status: "connected" | "disconnected" | "error";
  lastError: string | null;
  webhookUrl: string;
  meta: ChannelMeta;
}


interface SunnyContact {
  channelType: string;
  externalId: string;
}

const EXTERNAL_ID_HINTS: Record<string, { label: string; placeholder: string; hint: string }> = {
  telegram: {
    label: "Your Telegram Chat ID",
    placeholder: "e.g. 123456789",
    hint: "Send any message to @userinfobot on Telegram — it'll reply with your numeric ID",
  },
  slack: {
    label: "Your Slack User ID",
    placeholder: "e.g. U0123456789",
    hint: "In Slack: click your profile photo → Profile → ⋯ (three dots) → Copy Member ID",
  },
  whatsapp: {
    label: "Your WhatsApp Number",
    placeholder: "e.g. 923001234567 or +92 300 123 4567",
    hint: "Your full international phone number — any format works (with or without +, spaces, or dashes). The system normalises it automatically.",
  },
  teams: {
    label: "Your Teams User ID",
    placeholder: "e.g. 8:orgid:...",
    hint: "This is your Teams AAD Object ID — ask your Teams admin or check Teams settings",
  },
  discord: {
    label: "Your Discord User ID",
    placeholder: "e.g. 123456789012345678",
    hint: "Enable Developer Mode in Discord Settings → right-click your name → Copy User ID",
  },
};

function BossRegisterCode({ show }: { show: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchCode = async () => {
    setLoadingCode(true);
    try {
      const res = await fetch("/api/channels/boss-register-code");
      if (!res.ok) return;
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text) as { code: string; expiresAt: string };
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch { /* ignore transient errors */ } finally {
      setLoadingCode(false);
    }
  };

  const resetCode = async () => {
    setLoadingCode(true);
    try {
      const res = await fetch("/api/channels/boss-register-code/reset", { method: "POST" });
      if (!res.ok) return;
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text) as { code: string; expiresAt: string };
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch { /* ignore transient errors */ } finally {
      setLoadingCode(false);
    }
  };

  const copyCommand = () => {
    if (!code) return;
    void navigator.clipboard.writeText(`!boss ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { if (show) void fetchCode(); }, [show]);

  if (!show) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-2">
        <Key size={14} className="text-amber-400" />
        <p className="text-sm font-medium">Register via WhatsApp</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Don't know your WhatsApp number format? Send the command below from your phone to the customer-facing WhatsApp bot. The bot will instantly recognise your number as the boss.
      </p>
      {code ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-sm px-3 py-2 rounded-xl bg-muted/40 border border-border select-all tracking-widest text-center">
              !boss {code}
            </div>
            <button
              onClick={copyCommand}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs hover:bg-muted/60 transition-colors shrink-0"
            >
              {copied ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Expires: {expiresAt ? new Date(expiresAt).toLocaleString() : "—"}
            </p>
            <button
              onClick={() => void resetCode()}
              disabled={loadingCode}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              {loadingCode ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              New code
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-center py-3">
          {loadingCode ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : null}
        </div>
      )}
    </div>
  );
}

function SunnyContactCard({
  contact,
  connectedChannelTypes,
  onSaved,
  bossName,
}: {
  contact: SunnyContact | null;
  connectedChannelTypes: string[];
  onSaved: () => void;
  bossName: string;
}) {
  const [editing, setEditing] = useState(!contact?.channelType);
  const [channelType, setChannelType] = useState(contact?.channelType ?? "");
  const [externalId, setExternalId] = useState(contact?.externalId ?? "");
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contactLoaded = useRef(false);

  useEffect(() => {
    if (contact?.channelType && contact?.externalId) {
      setChannelType(contact.channelType);
      setExternalId(contact.externalId);
      setEditing(false);
      contactLoaded.current = true;
    } else if (contactLoaded.current && !contact?.channelType) {
      setChannelType("");
      setExternalId("");
      setEditing(true);
      contactLoaded.current = false;
    }
  }, [contact?.channelType, contact?.externalId]);

  const hint = channelType ? EXTERNAL_ID_HINTS[channelType] : null;
  const hasContact = Boolean(contact?.channelType && contact?.externalId);

  const save = async () => {
    if (!channelType || !externalId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/sunny-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelType, externalId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Failed to save"); return; }
      setEditing(false);
      onSaved();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await fetch("/api/channels/sunny-contact", { method: "DELETE" });
      setChannelType("");
      setExternalId("");
      setEditing(true);
      onSaved();
    } finally {
      setRemoving(false);
    }
  };

  const platform = PLATFORMS.find((p) => p.id === channelType);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <UserCircle2 size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">{bossName}'s Contact Channel</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Where the Brain should message you when a customer needs your attention
            </p>
          </div>
        </div>
        {hasContact && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="p-2 rounded-xl hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil size={15} />
          </button>
        )}
      </div>

      <div className="p-5">
        {!editing && hasContact && platform ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2.5 rounded-xl border", platform.bg, platform.border)}>
                <platform.icon size={18} className={platform.color} />
              </div>
              <div>
                <p className="font-medium text-sm">{platform.name}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{contact?.externalId}</p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
              </span>
            </div>
            <button
              onClick={() => void remove()}
              disabled={removing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 transition-colors disabled:opacity-60"
            >
              {removing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Which platform do you use?</label>
              <div className="relative">
                <select
                  value={channelType}
                  onChange={(e) => { setChannelType(e.target.value); setExternalId(""); }}
                  className="w-full appearance-none px-3 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 pr-8"
                >
                  <option value="">Select a platform…</option>
                  {PLATFORMS.map((p) => (
                    <option key={p.id} value={p.id} disabled={!connectedChannelTypes.includes(p.id)}>
                      {p.name}{!connectedChannelTypes.includes(p.id) ? " (not connected)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              {connectedChannelTypes.length === 0 && (
                <p className="text-xs text-amber-400 mt-1.5">Connect at least one platform below first</p>
              )}
            </div>

            {channelType && hint && (
              <div>
                <label className="block text-sm font-medium mb-1.5">{hint.label}</label>
                <input
                  type="text"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder={hint.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1.5">{hint.hint}</p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <XCircle size={14} /> {error}
              </div>
            )}

            <div className="flex gap-2">
              {hasContact && (
                <button
                  onClick={() => { setChannelType(contact?.channelType ?? ""); setExternalId(contact?.externalId ?? ""); setEditing(false); }}
                  className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted/60 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => void save()}
                disabled={loading || !channelType || !externalId.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Save Contact
              </button>
            </div>
          </div>
        )}
        <BossRegisterCode show={connectedChannelTypes.includes("whatsapp")} />
      </div>
    </div>
  );
}

interface BossBrainStatus {
  status: "connected" | "disconnected" | "error";
  platform: string | null;
  botUsername: string | null;
  phoneNumberId: string | null;
  webhookUrl: string | null;
  verifyToken?: string;
  sharedWebhook?: boolean;
  lastError: string | null;
}

function BossBrainCard({
  bossBrain,
  onSaved,
}: {
  bossBrain: BossBrainStatus | null;
  onSaved: () => void;
}) {
  const botName = useBotName();
  const isConnected = bossBrain?.status === "connected";
  const isError = bossBrain?.status === "error";
  const [editing, setEditing] = useState(!isConnected);
  const [platform, setPlatform] = useState(bossBrain?.platform ?? "telegram");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditing(!isConnected);
  }, [isConnected]);

  const BOSS_PLATFORMS = [
    { id: "telegram", label: "Telegram Bot", icon: Send, color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20" },
    { id: "whatsapp", label: "WhatsApp Business", icon: Phone, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  ] as const;

  const BOSS_FIELDS: Record<string, Array<{ key: string; label: string; placeholder: string; type?: string; hint?: string; optional?: boolean }>> = {
    telegram: [
      { key: "botToken", label: "Bot Token", placeholder: "1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", hint: "Create a SEPARATE private bot via @BotFather — this bot is only for you, not customers" },
    ],
    whatsapp: [
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "123456789012345", hint: "A SEPARATE WhatsApp Business number from your customer-facing one" },
      { key: "accessToken", label: "Access Token", placeholder: "EAAxxxx...", type: "password", hint: "Your Meta app access token" },
      { key: "verifyToken", label: "Verify Token", placeholder: "my-boss-brain-token", hint: "Any string you choose — paste this into the Meta webhook config" },
      { key: "bossPersonalNumber", label: "Your Personal WhatsApp Number", placeholder: "923001234567", hint: "Your own phone number in full international format, digits only, no + sign (e.g. 923001234567 for +92 300 123 4567). The bot uses this to recognise you as the boss.", optional: true },
    ],
  };

  const connect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/boss-brain/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, ...fields }),
      });
      const data = await res.json() as { error?: string; lastError?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Connection failed"); return; }
      if (data.lastError) { setError(data.lastError); }
      setEditing(false);
      setFields({});
      onSaved();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setRemoving(true);
    try {
      await fetch("/api/channels/boss-brain", { method: "DELETE" });
      setEditing(true);
      setFields({});
      onSaved();
    } finally {
      setRemoving(false);
    }
  };

  const copyWebhook = () => {
    if (bossBrain?.webhookUrl) {
      void navigator.clipboard.writeText(bossBrain.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const currentPlatformObj = BOSS_PLATFORMS.find((p) => p.id === bossBrain?.platform);

  return (
    <div className={cn(
      "rounded-2xl border bg-card overflow-hidden",
      isConnected ? "border-violet-500/30" : isError ? "border-red-500/30" : "border-border"
    )}>
      {isConnected && <div className="absolute inset-0 rounded-2xl ring-1 ring-violet-500/10 pointer-events-none" />}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-500/10">
            <Brain size={18} className="text-violet-400" />
          </div>
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-2">
              Boss → Brain Channel
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Private</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your private line to the Brain — give instructions, update memory, configure {botName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
            </span>
          )}
          {isConnected && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-2 rounded-xl hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {isConnected && !editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {currentPlatformObj && (
                  <div className={cn("p-2.5 rounded-xl border", currentPlatformObj.bg, currentPlatformObj.border)}>
                    <currentPlatformObj.icon size={18} className={currentPlatformObj.color} />
                  </div>
                )}
                <div>
                  <p className="font-medium text-sm">{currentPlatformObj?.label ?? bossBrain?.platform}</p>
                  {bossBrain?.botUsername && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">@{bossBrain.botUsername}</p>
                  )}
                  {bossBrain?.phoneNumberId && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {bossBrain.phoneNumberId}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => void disconnect()}
                disabled={removing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 transition-colors disabled:opacity-60"
              >
                {removing ? <Loader2 size={12} className="animate-spin" /> : <Link2Off size={12} />}
                Disconnect
              </button>
            </div>

            {bossBrain?.webhookUrl && (
              <div className="space-y-2">
                {bossBrain.sharedWebhook && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 text-xs text-amber-300 leading-relaxed">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Meta only allows <strong>one webhook per app</strong>. Configure this URL in your Meta app — our server routes messages by phone number ID automatically.
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    {bossBrain.sharedWebhook ? "Configure this URL in Meta → WhatsApp → Configuration → Webhooks" : "Webhook URL"}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-xl bg-background border border-border text-xs font-mono text-muted-foreground truncate">
                      {bossBrain.webhookUrl}
                    </div>
                    <button
                      onClick={copyWebhook}
                      className="p-2 rounded-xl border border-border hover:bg-muted/60 transition-colors shrink-0"
                      title="Copy webhook URL"
                    >
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                {bossBrain.platform === "whatsapp" && bossBrain.verifyToken && (
                  <p className="text-xs text-muted-foreground">
                    Verify Token: <span className="font-mono text-foreground/70">{bossBrain.verifyToken}</span>
                  </p>
                )}
              </div>
            )}

            {isError && bossBrain?.lastError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                <AlertCircle size={13} /> {bossBrain.lastError}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-violet-300 leading-relaxed">
              <Cpu size={12} className="inline mr-1.5 -mt-0.5" />
              Set up a <strong>separate</strong> bot or number that only you know — this is your private command line to the Brain. Customers should never see this.
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Platform</label>
              <div className="flex gap-2">
                {BOSS_PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setPlatform(p.id); setFields({}); }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors flex-1 justify-center",
                      platform === p.id
                        ? cn("border-violet-500/40 bg-violet-500/10 text-violet-300")
                        : "border-border hover:bg-muted/40 text-muted-foreground"
                    )}
                  >
                    <p.icon size={14} className={platform === p.id ? p.color : ""} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {BOSS_FIELDS[platform]?.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium mb-1.5">{field.label}</label>
                <input
                  type={field.type ?? "text"}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30 font-mono"
                />
                {field.hint && <p className="text-xs text-muted-foreground mt-1.5">{field.hint}</p>}
              </div>
            ))}

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <XCircle size={14} /> {error}
              </div>
            )}

            <div className="flex gap-2">
              {isConnected && (
                <button
                  onClick={() => { setEditing(false); setFields({}); setError(null); }}
                  className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted/60 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => void connect()}
                disabled={loading || !platform || BOSS_FIELDS[platform]?.some((f) => !f.optional && !fields[f.key]?.trim())}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Connect Boss-Brain Channel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface Platform {
  id: string;
  name: string;
  tagline: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  setupUrl: string;
  fields: Array<{ key: string; label: string; placeholder: string; type?: string; hint?: string }>;
  instructions: string[];
}

const PLATFORMS: Platform[] = [
  {
    id: "telegram",
    name: "Telegram",
    tagline: "Chat with your Brain via Telegram bot",
    icon: Send,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
    setupUrl: "https://t.me/BotFather",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", hint: "Get this from @BotFather on Telegram" },
    ],
    instructions: [
      "Open @BotFather on Telegram and send /newbot",
      "Follow the prompts to name your bot",
      "Copy the API token BotFather gives you",
      "Paste it here — we'll register the webhook automatically",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    tagline: "Talk to the Brain from any Slack workspace",
    icon: Hash,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    setupUrl: "https://api.slack.com/apps",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", hint: "OAuth & Permissions → Bot User OAuth Token" },
      { key: "signingSecret", label: "Signing Secret", placeholder: "abc123...", type: "password", hint: "Basic Information → App Credentials → Signing Secret" },
      { key: "channelId", label: "Default Channel ID", placeholder: "C0123456789", hint: "Right-click any channel → Copy Channel ID" },
    ],
    instructions: [
      "Go to api.slack.com/apps and create a new app",
      "Add bot scopes: chat:write, channels:history, im:history",
      "Install the app to your workspace",
      "Copy the Bot Token and Signing Secret",
      "Set the Event Subscriptions Request URL to the webhook URL shown below",
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    tagline: "Use WhatsApp Business to reach the Brain",
    icon: Phone,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    setupUrl: "https://developers.facebook.com/apps",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "123456789012345", hint: "developers.facebook.com → Your App → WhatsApp → API Setup → 'Phone Number ID' (below 'From')" },
      { key: "accessToken", label: "Access Token", placeholder: "EAAxxxx...", type: "password", hint: "developers.facebook.com → Your App → WhatsApp → API Setup → 'Temporary access token' (or generate a permanent token via System User)" },
      { key: "verifyToken", label: "Verify Token (custom)", placeholder: "my-secret-token", hint: "Choose any string you like — you will paste this same value into the Meta webhook configuration panel" },
    ],
    instructions: [
      "Go to developers.facebook.com/apps and create a new app (Business type)",
      "Add the 'WhatsApp' product to your app from the dashboard",
      "Open WhatsApp → API Setup: copy the 'Phone Number ID' shown under the 'From' dropdown",
      "On the same page, copy the 'Temporary access token' (valid 24 h) — or go to Business Settings → System Users to generate a permanent token",
      "Choose any Verify Token string (e.g. 'excbot-whatsapp-verify') and paste it here",
      "In Meta: WhatsApp → Configuration → Webhooks → Edit: paste the Webhook URL shown below and your Verify Token, then click Verify & Save",
      "Subscribe to the 'messages' webhook field so the bot receives incoming messages",
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    tagline: "Send and receive Brain messages in Teams",
    icon: Users,
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
    setupUrl: "https://teams.microsoft.com",
    fields: [
      { key: "incomingWebhookUrl", label: "Incoming Webhook URL", placeholder: "https://xxx.webhook.office.com/webhookb2/...", hint: "In Teams: channel → ⋯ → Connectors → Incoming Webhook" },
      { key: "hmacToken", label: "HMAC Security Token (optional)", placeholder: "leave blank to skip verification", type: "password", hint: "Outgoing webhook security token from Teams" },
      { key: "connectorLabel", label: "Label (optional)", placeholder: "MateOS Brain", hint: "Display name for this connection" },
    ],
    instructions: [
      "In the Teams channel, click ⋯ → Connectors → Incoming Webhook",
      "Name it 'MateOS Brain' and copy the webhook URL",
      "For two-way messages, also create an Outgoing Webhook and paste the HMAC token here",
      "Set the outgoing webhook URL to the webhook URL shown below",
    ],
  },
  {
    id: "discord",
    name: "Discord",
    tagline: "Let the Brain live in your Discord server",
    icon: Headphones,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    setupUrl: "https://discord.com/developers/applications",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "MTxxxxxx.xxx.xxx", type: "password", hint: "Bot section → Token → Reset Token" },
      { key: "applicationId", label: "Application ID", placeholder: "1234567890123456789", hint: "General Information → Application ID" },
      { key: "publicKey", label: "Public Key", placeholder: "abc1234...", hint: "General Information → Public Key" },
      { key: "guildId", label: "Server ID (optional)", placeholder: "Leave blank for global", hint: "Enable developer mode → right-click server → Copy ID" },
    ],
    instructions: [
      "Go to discord.com/developers/applications and create a new app",
      "Under Bot, create a bot and copy the token",
      "Copy the Application ID and Public Key from General Information",
      "Invite the bot to your server with message read/send permissions",
      "Set the Interactions Endpoint URL to the webhook URL shown below",
    ],
  },
];

function getPlatform(type: string) {
  return PLATFORMS.find((p) => p.id === type);
}

function ChannelBadge({ type }: { type: string }) {
  const p = getPlatform(type);
  if (!p) return <span className="text-xs text-muted-foreground capitalize">{type}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", p.color)}>
      <p.icon size={12} />
      {p.name}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="shrink-0 p-1.5 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Connected
    </span>
  );
  if (status === "error") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
      <AlertCircle size={12} /> Error
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" /> Not connected
    </span>
  );
}

interface ConnectModalProps {
  platform: Platform;
  status: ChannelStatus | undefined;
  onClose: () => void;
  onConnected: () => void;
}

function ConnectModal({ platform, status, onClose, onConnected }: ConnectModalProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${platform.id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json() as { success?: boolean; error?: string; lastError?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? data.lastError ?? "Connection failed");
      } else {
        setSuccess(true);
        setTimeout(() => { onConnected(); onClose(); }, 1200);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  };

  const webhookUrl = status?.webhookUrl ?? "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className={cn("flex items-center justify-between p-5 border-b border-border", platform.bg)}>
          <div className="flex items-center gap-3">
            <div className={cn("p-2.5 rounded-xl border", platform.bg, platform.border)}>
              <platform.icon size={20} className={platform.color} />
            </div>
            <div>
              <h2 className="font-semibold text-base">Connect {platform.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{platform.tagline}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {platform.fields.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-medium mb-1.5">{f.label}</label>
              <input
                type={f.type ?? "text"}
                value={fields[f.key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                autoComplete="off"
              />
              {f.hint && <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>}
            </div>
          ))}

          <div className="rounded-xl bg-muted/40 border border-border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Setup Instructions</p>
            <ol className="space-y-1">
              {platform.instructions.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold mt-px">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <a href={platform.setupUrl} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1.5 text-xs font-medium mt-1", platform.color)}>
              Open {platform.name} Developer Portal <ExternalLink size={11} />
            </a>
          </div>

          {webhookUrl && (
            <div>
              <p className="text-xs font-medium mb-1.5">Webhook URL <span className="text-muted-foreground font-normal">(copy this into your platform settings)</span></p>
              <div className="flex items-center gap-2 bg-muted/60 rounded-xl border border-border px-3 py-2">
                <code className="text-xs text-muted-foreground truncate flex-1">{webhookUrl}</code>
                <CopyButton text={webhookUrl} />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              <XCircle size={16} className="shrink-0 mt-px" /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/60 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2",
                success ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {success && <CheckCircle2 size={14} />}
              {success ? "Connected!" : loading ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

const ELEVENLABS_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Warm, professional, calm — recommended" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", desc: "Soft, gentle, empathetic" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", desc: "Strong, confident, direct" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", desc: "Upbeat, friendly, youthful" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", desc: "Warm, casual, natural male voice" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", desc: "Authoritative, professional male" },
] as const;

interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
}

interface VoiceStatus {
  status: "connected" | "disconnected" | "error";
  phoneNumber: string;
  greeting: string;
  webhookUrl: string;
  lastError?: string | null;
  elevenlabsEnabled?: boolean;
  voiceId?: string;
  voiceName?: string;
}

function VoiceBrowser({
  currentVoiceId,
  onSaved,
  onClose,
}: {
  currentVoiceId: string;
  onSaved: (voiceId: string, voiceName: string) => void;
  onClose: () => void;
}) {
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(currentVoiceId);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/channels/voice/elevenlabs-voices");
        const data = await res.json() as { voices?: ElevenLabsVoice[]; error?: string };
        if (!res.ok || data.error) { setError(data.error ?? "Failed to load voices"); return; }
        setVoices(data.voices ?? []);
      } catch {
        setError("Network error — could not load voices");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = ["all", ...Array.from(new Set(voices.map((v) => v.category))).sort()];

  const filtered = voices.filter((v) => {
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase()) ||
      Object.values(v.labels).some((l) => l.toLowerCase().includes(search.toLowerCase()));
    const matchCategory = category === "all" || v.category === category;
    return matchSearch && matchCategory;
  });

  const playPreview = (voice: ElevenLabsVoice) => {
    if (!voice.previewUrl) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingId === voice.voiceId) {
      setPlayingId(null);
      return;
    }

    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setPlayingId(voice.voiceId);
    audio.play().catch(() => setPlayingId(null));
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, []);

  const save = async () => {
    const v = voices.find((x) => x.voiceId === selectedId);
    if (!v) return;
    setSaving(true);
    try {
      const res = await fetch("/api/channels/voice/set-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: v.voiceId, voiceName: v.name }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Save failed"); return; }
      onSaved(v.voiceId, v.name);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const labelColors: Record<string, string> = {
    female: "bg-pink-500/10 text-pink-400 border-pink-500/20",
    male: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    young: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    middle_aged: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    old: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    american: "bg-[#0078d4]/10 text-[#0078d4] border-[#0078d4]/20",
    british: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    african: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    australian: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  };

  const getLabelClass = (val: string) => labelColors[val.toLowerCase()] ?? "bg-muted/60 text-muted-foreground border-border";

  return (
    <div className="rounded-2xl border border-[#0078d4]/20 bg-[#0078d4]/5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#0078d4]/15 bg-[#0078d4]/5">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-[#0078d4]" />
          <span className="text-sm font-semibold text-foreground">Choose a Voice</span>
          {!loading && <span className="text-xs text-muted-foreground">({voices.length} available from your ElevenLabs account)</span>}
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading voices from ElevenLabs…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            <XCircle size={14} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, accent, style…"
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0078d4]/40"
                />
              </div>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                    category === cat
                      ? "bg-[#0078d4]/15 border-[#0078d4]/40 text-[#0078d4]"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {cat === "all" ? `All (${voices.length})` : cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">No voices match your search.</p>
              )}
              {filtered.map((v) => {
                const isSelected = selectedId === v.voiceId;
                const isPlaying = playingId === v.voiceId;
                const labelEntries = Object.entries(v.labels ?? {}).slice(0, 4);

                return (
                  <div
                    key={v.voiceId}
                    onClick={() => setSelectedId(v.voiceId)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      isSelected
                        ? "bg-[#0078d4]/10 border-[#0078d4]/40"
                        : "border-border hover:bg-muted/40"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                      isSelected ? "bg-[#0078d4] border-[#0078d4]" : "border-muted-foreground/40"
                    )}>
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-sm font-semibold", isSelected ? "text-[#0078d4]" : "text-foreground")}>
                          {v.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border capitalize">
                          {v.category}
                        </span>
                        {labelEntries.map(([, val]) => (
                          <span key={val} className={cn("text-xs px-2 py-0.5 rounded-full border capitalize", getLabelClass(val))}>
                            {val.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                      {v.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{v.description}</p>
                      )}
                    </div>

                    {v.previewUrl && (
                      <button
                        onClick={(e) => { e.stopPropagation(); playPreview(v); }}
                        className={cn(
                          "p-2 rounded-lg border transition-colors shrink-0",
                          isPlaying
                            ? "bg-[#0078d4]/15 border-[#0078d4]/40 text-[#0078d4]"
                            : "border-border hover:bg-muted/60 text-muted-foreground"
                        )}
                        title={isPlaying ? "Stop" : "Preview voice"}
                      >
                        {isPlaying ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {selectedId !== currentVoiceId
                  ? `Selected: ${voices.find((v) => v.voiceId === selectedId)?.name ?? selectedId}`
                  : "No changes"}
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 rounded-xl border border-border text-sm hover:bg-muted/60 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => void save()}
                  disabled={saving || selectedId === currentVoiceId}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-[#0078d4] border border-[#0078d4] text-white text-sm font-medium hover:bg-[#006cbe] disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {saving ? "Saving…" : "Use This Voice"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VoiceCard({ voice, onRefresh }: { voice: VoiceStatus | null; onRefresh: () => void }) {
  const botName = useBotName();
  const bossName = useBossName();
  const [editing, setEditing] = useState(!voice || voice.status !== "connected");
  const [phoneNumber, setPhoneNumber] = useState(voice?.phoneNumber ?? "");
  const [greeting, setGreeting] = useState(voice?.greeting ?? "");
  const [voiceId, setVoiceId] = useState(voice?.voiceId ?? "21m00Tcm4TlvDq8ikWAM");
  const [activeName, setActiveName] = useState(voice?.voiceName ?? "Rachel");
  const [showBrowser, setShowBrowser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testCalling, setTestCalling] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isConnected = voice?.status === "connected";

  useEffect(() => {
    if (voice?.status === "connected") {
      setEditing(false);
      setPhoneNumber(voice.phoneNumber);
      setGreeting(voice.greeting);
      if (voice.voiceId) setVoiceId(voice.voiceId);
      if (voice.voiceName) setActiveName(voice.voiceName);
    }
  }, [voice?.status, voice?.phoneNumber, voice?.greeting, voice?.voiceId, voice?.voiceName]);

  const connect = async () => {
    if (!phoneNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/voice/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim(), greeting: greeting.trim(), voiceId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Connection failed"); return; }
      setEditing(false);
      onRefresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch("/api/channels/voice/disconnect", { method: "POST" });
    setEditing(true);
    onRefresh();
    setDisconnecting(false);
  };

  const copyUrl = () => {
    if (voice?.webhookUrl) {
      void navigator.clipboard.writeText(voice.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const makeTestCall = async () => {
    if (!testNumber.trim()) return;
    setTestCalling(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/channels/voice/test-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: testNumber.trim() }),
      });
      const data = await res.json() as { error?: string; from?: string };
      if (!res.ok || data.error) {
        setTestResult({ ok: false, message: data.error ?? "Call failed" });
      } else {
        setTestResult({ ok: true, message: `Calling ${testNumber.trim()} now from ${data.from ?? voice?.phoneNumber ?? "the Brain"}. Pick up and start talking!` });
      }
    } catch {
      setTestResult({ ok: false, message: "Network error — please try again" });
    } finally {
      setTestCalling(false);
    }
  };

  return (
    <div className={cn(
      "rounded-2xl border bg-card overflow-hidden",
      isConnected ? "border-emerald-500/20" : "border-border"
    )}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-gradient-to-r from-emerald-500/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <PhoneCall size={20} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="font-semibold text-base">Voice / Phone</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Give the Brain a phone number — anyone can call and talk to it</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
            </span>
          )}
          {voice?.status === "error" && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <AlertCircle size={12} /> Error
            </span>
          )}
          {isConnected && !editing && (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors">
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {isConnected && !editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted/40 border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Phone number</p>
                <p className="text-sm font-mono font-semibold text-emerald-400">{voice.phoneNumber}</p>
              </div>
              <div className="rounded-xl bg-muted/40 border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Greeting</p>
                <p className="text-sm text-foreground/80 truncate">{voice.greeting}</p>
              </div>
            </div>

            {voice.webhookUrl && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Webhook URL <span className="font-normal">(auto-configured on Twilio)</span></p>
                <div
                  onClick={copyUrl}
                  className="flex items-center gap-2 bg-muted/40 rounded-xl border border-border px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors"
                >
                  <code className="text-xs text-muted-foreground truncate flex-1">{voice.webhookUrl}</code>
                  {copied ? <Check size={13} className="text-emerald-400 shrink-0" /> : <Copy size={13} className="text-muted-foreground shrink-0" />}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3 flex items-start gap-2">
              <Mic size={14} className="text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-400 leading-relaxed">
                Anyone who calls <strong>{voice.phoneNumber}</strong> will be answered by {botName} using your soul.md personality. She can answer questions, take meeting requests, and escalate to you when needed.
              </p>
            </div>

            {voice.elevenlabsEnabled ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0078d4]/5 border border-[#0078d4]/20 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#0078d4] animate-pulse shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-[#0078d4]">ElevenLabs voice active</p>
                      <p className="text-xs text-muted-foreground">Currently using <strong className="text-foreground">{activeName}</strong></p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowBrowser((s) => !s)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                      showBrowser
                        ? "bg-[#0078d4]/15 border-[#0078d4]/30 text-[#0078d4]"
                        : "border-border text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    <Volume2 size={12} />
                    {showBrowser ? "Close" : "Change Voice"}
                    {showBrowser ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                <AnimatePresence>
                  {showBrowser && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <VoiceBrowser
                        currentVoiceId={voiceId}
                        onSaved={(id, name) => {
                          setVoiceId(id);
                          setActiveName(name);
                          setShowBrowser(false);
                          onRefresh();
                        }}
                        onClose={() => setShowBrowser(false)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-amber-400">Standard voice only — upgrade to ElevenLabs for a human-sounding voice</p>
                    <p className="text-xs text-muted-foreground">
                      Add your ElevenLabs API key as a secret named <code className="font-mono bg-muted/60 px-1 rounded">ELEVENLABS_API_KEY</code> to unlock {botName}'s warm, empathetic voice. Get a free key at{" "}
                      <a href="https://elevenlabs.io" target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">elevenlabs.io</a>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <PhoneCall size={13} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Test the Brain by phone</p>
                  <p className="text-xs text-muted-foreground">Enter any phone number — the Brain will call you and you can have a real conversation</p>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={testNumber}
                  onChange={(e) => { setTestNumber(e.target.value); setTestResult(null); }}
                  placeholder="+14155559876"
                  className="flex-1 px-3 py-2 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <button
                  onClick={() => void makeTestCall()}
                  disabled={testCalling || !testNumber.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 border border-primary/25 text-primary text-sm font-medium hover:bg-primary/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {testCalling ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
                  {testCalling ? "Calling…" : "Call me now"}
                </button>
              </div>

              {testResult && (
                <div className={cn(
                  "flex items-start gap-2 p-3 rounded-xl text-xs leading-relaxed",
                  testResult.ok
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                )}>
                  {testResult.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <XCircle size={13} className="shrink-0 mt-0.5" />}
                  {testResult.message}
                </div>
              )}
            </div>

            <button
              onClick={() => void disconnect()}
              disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 transition-colors disabled:opacity-60"
            >
              {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <PhoneOff size={12} />}
              Disconnect phone number
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Twilio phone number</label>
              <input
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+14155551234"
                className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1.5">The number you purchased on Twilio, in E.164 format (starting with +)</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Opening greeting</label>
              <textarea
                rows={2}
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder={`Hi! I'm ${botName}, ${bossName}'s AI assistant…`}
                className="w-full px-3 py-2.5 rounded-xl bg-background border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">What callers hear first. Keep it short and natural.</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Voice for ElevenLabs <span className="text-muted-foreground font-normal">(if API key is set)</span></label>
              <div className="space-y-1.5">
                {ELEVENLABS_VOICES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoiceId(v.id)}
                    className={cn(
                      "w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl border text-sm transition-colors",
                      voiceId === v.id
                        ? "bg-[#0078d4]/10 border-[#0078d4]/30 text-foreground"
                        : "border-border hover:bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <span className={cn("w-3 h-3 rounded-full border-2 shrink-0", voiceId === v.id ? "bg-[#0078d4] border-[#0078d4]" : "border-muted-foreground/40")} />
                    <span>
                      <span className="font-medium text-foreground">{v.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{v.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Falls back to Amazon Polly if ElevenLabs API key is not set.</p>
            </div>

            <div className="rounded-xl bg-muted/40 border border-border p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens when you connect</p>
              {[
                "We automatically set the webhook on your Twilio number — no manual setup needed",
                `Anyone who calls will be greeted by ${botName} and can have a full voice conversation`,
                "Meeting requests, questions, and escalations all work through voice just like messaging",
              ].map((s, i) => (
                <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-px" />
                  {s}
                </div>
              ))}
            </div>

            {voice?.lastError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <XCircle size={14} className="shrink-0 mt-px" /> {voice.lastError}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <XCircle size={14} className="shrink-0 mt-px" /> {error}
              </div>
            )}

            <div className="flex gap-2">
              {isConnected && (
                <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted/60 transition-colors">Cancel</button>
              )}
              <button
                onClick={() => void connect()}
                disabled={loading || !phoneNumber.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-sm font-medium hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
                {loading ? "Connecting…" : "Connect Phone Number"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Channels() {
  const botName = useBotName();
  const bossName = useBossName();
  const [channelStatuses, setChannelStatuses] = useState<ChannelStatus[]>([]);
  const [sunnyContact, setSunnyContact] = useState<SunnyContact | null>(null);
  const [bossBrain, setBossBrain] = useState<BossBrainStatus | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const [statusRes, contactRes, bossBrainRes, voiceRes] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/channels/sunny-contact"),
        fetch("/api/channels/boss-brain"),
        fetch("/api/channels/voice/status"),
      ]);
      const [statusData, contactData, bossBrainData, voiceData] = await Promise.all([
        statusRes.json() as Promise<ChannelStatus[]>,
        contactRes.json() as Promise<SunnyContact>,
        bossBrainRes.json() as Promise<BossBrainStatus>,
        voiceRes.json() as Promise<VoiceStatus>,
      ]);
      setChannelStatuses(statusData);
      setSunnyContact(contactData.channelType ? contactData : null);
      setBossBrain(bossBrainData);
      setVoiceStatus(voiceData);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatuses();
    const interval = setInterval(() => void fetchStatuses(), 8000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  const disconnect = async (type: string) => {
    setDisconnecting(type);
    try {
      await fetch(`/api/channels/${type}/disconnect`, { method: "POST" });
      await fetchStatuses();
    } finally {
      setDisconnecting(null);
    }
  };

  const copyWebhookUrl = (url: string, type: string) => {
    void navigator.clipboard.writeText(url);
    setCopiedUrl(type);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const connectedCount = channelStatuses.filter((c) => c.status === "connected").length;
  const activePlatform = PLATFORMS.find((p) => p.id === activeModal);
  const activeStatus = channelStatuses.find((c) => c.channelType === activeModal);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Channels</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Connect your Brain to external messaging platforms. Talk to it from anywhere.
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-card border border-border text-sm">
            {connectedCount > 0 ? <Wifi size={16} className="text-emerald-400" /> : <WifiOff size={16} className="text-muted-foreground" />}
            <span className={connectedCount > 0 ? "text-emerald-400 font-medium" : "text-muted-foreground"}>{connectedCount} connected</span>
          </div>
        )}
      </div>

      <SunnyContactCard
        contact={sunnyContact}
        connectedChannelTypes={channelStatuses.filter((c) => c.status === "connected").map((c) => c.channelType)}
        onSaved={() => void fetchStatuses()}
        bossName={bossName}
      />

      <BossBrainCard
        bossBrain={bossBrain}
        onSaved={() => void fetchStatuses()}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-52 rounded-2xl bg-card/50 border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PLATFORMS.map((platform) => {
            const status = channelStatuses.find((c) => c.channelType === platform.id);
            const isConnected = status?.status === "connected";
            const isError = status?.status === "error";
            const isDisconnecting = disconnecting === platform.id;

            return (
              <motion.div
                key={platform.id}
                layout
                className={cn(
                  "relative group rounded-2xl border bg-card p-5 flex flex-col gap-4 transition-shadow hover:shadow-lg",
                  isConnected ? "border-border shadow-sm" : "border-border",
                  isError && "border-red-500/30"
                )}
              >
                {isConnected && <div className="absolute inset-0 rounded-2xl ring-1 ring-emerald-500/20 pointer-events-none" />}

                <div className="flex items-start justify-between gap-3">
                  <div className={cn("p-3 rounded-xl border", platform.bg, platform.border)}>
                    <platform.icon size={22} className={platform.color} />
                  </div>
                  <StatusBadge status={status?.status ?? "disconnected"} />
                </div>

                <div className="flex-1">
                  <h3 className="font-semibold text-base">{platform.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{platform.tagline}</p>

                  {isConnected && status?.meta && (
                    <div className="mt-3 space-y-1">
                      {status.meta.botUsername && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">Bot:</span> @{status.meta.botUsername}</p>}
                      {status.meta.channelId && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">Channel:</span> {status.meta.channelId}</p>}
                      {status.meta.applicationId && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">App ID:</span> {status.meta.applicationId}</p>}
                      {status.meta.connectorLabel && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">Label:</span> {status.meta.connectorLabel}</p>}
                    </div>
                  )}

                  {isError && status?.lastError && (
                    <p className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-2 py-1.5">{status.lastError}</p>
                  )}
                </div>

                {isConnected && status?.webhookUrl && (
                  <div
                    className="flex items-center gap-2 bg-muted/40 rounded-lg border border-border px-2.5 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors"
                    onClick={() => copyWebhookUrl(status.webhookUrl, platform.id)}
                    title="Click to copy webhook URL"
                  >
                    <code className="text-xs text-muted-foreground truncate flex-1">{status.webhookUrl.replace("https://", "")}</code>
                    {copiedUrl === platform.id ? <Check size={12} className="text-emerald-400 shrink-0" /> : <Copy size={12} className="text-muted-foreground shrink-0" />}
                  </div>
                )}

                <div className="flex gap-2">
                  {isConnected ? (
                    <>
                      <button onClick={() => setActiveModal(platform.id)} className="flex-1 py-2 rounded-xl border border-border text-xs font-medium hover:bg-muted/60 transition-colors flex items-center justify-center gap-1.5">
                        Reconfigure <ChevronRight size={12} />
                      </button>
                      <button
                        onClick={() => void disconnect(platform.id)}
                        disabled={isDisconnecting}
                        className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {isDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <WifiOff size={12} />}
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setActiveModal(platform.id)}
                      className={cn("w-full py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2", "bg-primary/10 border border-primary/20 hover:bg-primary/20", platform.color)}
                    >
                      Connect {platform.name} <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <VoiceCard voice={voiceStatus} onRefresh={() => void fetchStatuses()} />

      <div className="rounded-2xl bg-card/50 border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-primary/10">
            <CheckCircle2 size={16} className="text-primary" />
          </div>
          <h3 className="font-semibold text-sm">How two-way communication works</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "Customer messages", desc: "Someone sends a message to your connected bot on Telegram, Slack, Discord, etc." },
            { step: "2", title: "Brain processes it", desc: "The AI handles routine questions independently using your preferences and info." },
            { step: "3", title: "Escalates to you", desc: "If it needs your decision, you get a notification here with the full context." },
            { step: "4", title: "You reply", desc: "Type your reply here — it's sent directly to the customer on their original platform." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">{step}</div>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {activeModal && activePlatform && (
          <ConnectModal
            platform={activePlatform}
            status={activeStatus}
            onClose={() => setActiveModal(null)}
            onConnected={() => void fetchStatuses()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
