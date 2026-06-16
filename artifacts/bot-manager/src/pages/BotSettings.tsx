import { useState, useEffect } from "react";
import { useBossPreferences, useUpdateBossPreferences, useBotName, useBossName } from "@/hooks/use-preferences";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Loader2, Phone, Calendar, Mail, MessageSquare,
  ClipboardList, Settings2, CheckSquare, ChevronDown, ChevronUp,
  ShieldCheck, User2, FileText, Globe, Mic2, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TOOLS = [
  {
    key: "calendar",
    label: "Calendar",
    Icon: Calendar,
    description: "Microsoft 365 calendar — read events and availability.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    graphPerms: [
      { key: "Calendars.Read", label: "Calendars.Read", description: "Read user calendars" },
      { key: "Calendars.ReadWrite", label: "Calendars.ReadWrite", description: "Full access to user calendars (create, edit, delete)" },
    ],
    internalPerms: [],
  },
  {
    key: "email",
    label: "Outlook Mail",
    Icon: Mail,
    description: "Outlook inbox — read and summarize emails.",
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    graphPerms: [
      { key: "email", label: "email", description: "View users' email address" },
      { key: "Files.ReadWrite.All", label: "Files.ReadWrite.All", description: "Full access to all files the user can access" },
      { key: "Sites.Read.All", label: "Sites.Read.All", description: "Read items in all SharePoint site collections" },
      { key: "Sites.ReadWrite.All", label: "Sites.ReadWrite.All", description: "Edit or delete items in all site collections" },
    ],
    internalPerms: [],
  },
  {
    key: "teams",
    label: "Teams Chats",
    Icon: MessageSquare,
    description: "Microsoft Teams — read chats, channels, and messages.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    graphPerms: [
      { key: "ChatMessage.Read", label: "ChatMessage.Read", description: "Read user chat messages" },
      { key: "ChatMessage.Send", label: "ChatMessage.Send", description: "Send user chat messages" },
      { key: "Chat.ReadWrite", label: "Chat.ReadWrite", description: "Read and write user chat messages" },
      { key: "Chat.Create", label: "Chat.Create", description: "Create new chats" },
      { key: "ChannelMessage.Read.All", label: "ChannelMessage.Read.All", description: "Read user channel messages" },
      { key: "ChannelMessage.ReadWrite", label: "ChannelMessage.ReadWrite", description: "Read and write user channel messages" },
      { key: "ChannelMessage.Send", label: "ChannelMessage.Send", description: "Send channel messages" },
      { key: "Channel.ReadBasic.All", label: "Channel.ReadBasic.All", description: "Read the names and descriptions of channels" },
      { key: "Team.ReadBasic.All", label: "Team.ReadBasic.All", description: "Read the names and descriptions of teams" },
      { key: "TeamsActivity.Read", label: "TeamsActivity.Read", description: "Read user's teamwork activity feed" },
      { key: "TeamsActivity.Send", label: "TeamsActivity.Send", description: "Send a teamwork activity as the user" },
    ],
    internalPerms: [],
  },
  {
    key: "meeting_requests",
    label: "Meeting Requests",
    Icon: ClipboardList,
    description: "View pending meeting requests from callers.",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    graphPerms: [
      { key: "User.Read", label: "User.Read", description: "Sign in and read user profile" },
    ],
    internalPerms: [
      { key: "list_pending", label: "List pending requests", description: "See requests waiting for approval" },
      { key: "view_details", label: "View full details", description: "Read complete request information" },
    ],
  },
  {
    key: "preferences",
    label: "Preferences",
    Icon: Settings2,
    description: "Access scheduling preferences (mood, limits, notes).",
    color: "text-green-500",
    bg: "bg-green-500/10",
    graphPerms: [
      { key: "User.Read", label: "User.Read", description: "Sign in and read user profile" },
    ],
    internalPerms: [
      { key: "read_mood", label: "Read mood / status", description: "Know your current availability" },
      { key: "read_schedule", label: "Read schedule limits", description: "Know max meetings and preferred times" },
      { key: "read_notes", label: "Read personal notes", description: "Access extra scheduling notes" },
    ],
  },
  {
    key: "submit_meeting_request",
    label: "Submit Meeting Request",
    Icon: CheckSquare,
    description: "Silently log a meeting request after gathering caller details.",
    color: "text-sky-500",
    bg: "bg-sky-500/10",
    graphPerms: [],
    internalPerms: [
      { key: "collect_details", label: "Collect caller details", description: "Ask for name, desired time, and purpose" },
      { key: "confirm_submission", label: "Confirm submission", description: "Tell caller the request was logged" },
    ],
  },
  {
    key: "files",
    label: "Files & SharePoint",
    Icon: FileText,
    description: "Access OneDrive files and SharePoint document libraries.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    graphPerms: [
      { key: "Files.ReadWrite.All", label: "Files.ReadWrite.All", description: "Full access to all files user can access" },
      { key: "Sites.Read.All", label: "Sites.Read.All", description: "Read items in all site collections" },
      { key: "Sites.ReadWrite.All", label: "Sites.ReadWrite.All", description: "Edit or delete items in all site collections" },
    ],
    internalPerms: [],
  },
  {
    key: "user_profile",
    label: "User Profile",
    Icon: Globe,
    description: "Read the signed-in user's profile information.",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    graphPerms: [
      { key: "User.Read", label: "User.Read", description: "Sign in and read user profile" },
      { key: "email", label: "email", description: "View users' email address" },
    ],
    internalPerms: [],
  },
];

type RoleToolPerm = { enabled: boolean; perms: Record<string, boolean> };
type ToolRoleConfig = { boss: RoleToolPerm; customer: RoleToolPerm };
type ToolConfig = Record<string, ToolRoleConfig>;

function buildDefaultRolePerm(tool: (typeof TOOLS)[0], enabled: boolean): RoleToolPerm {
  const perms: Record<string, boolean> = {};
  for (const p of tool.graphPerms) perms[p.key] = enabled;
  for (const p of tool.internalPerms) perms[p.key] = enabled;
  return { enabled, perms };
}

function getDefaultConfig(): ToolConfig {
  const cfg: ToolConfig = {};
  for (const t of TOOLS) {
    const isBossDefault = !["submit_meeting_request"].includes(t.key);
    const isCustomerDefault = t.key === "submit_meeting_request";
    cfg[t.key] = {
      boss: buildDefaultRolePerm(t, isBossDefault),
      customer: buildDefaultRolePerm(t, isCustomerDefault),
    };
  }
  return cfg;
}

function parseConfig(raw: string | null | undefined): ToolConfig {
  const base = getDefaultConfig();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ToolRoleConfig>>;
    for (const t of TOOLS) {
      if (parsed[t.key]) {
        const src = parsed[t.key];
        for (const role of ["boss", "customer"] as const) {
          if (src[role]) {
            base[t.key][role] = {
              enabled: src[role]!.enabled ?? base[t.key][role].enabled,
              perms: { ...base[t.key][role].perms, ...src[role]!.perms },
            };
          }
        }
      }
    }
  } catch { /* use default */ }
  return base;
}

function PermToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!enabled)}
      className={cn(
        "w-9 h-5 rounded-full relative transition-all cursor-pointer shrink-0",
        enabled ? "bg-[#0078d4]" : "bg-muted-foreground/25"
      )}
    >
      <div className={cn(
        "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all",
        enabled ? "left-4" : "left-0.5"
      )} />
    </div>
  );
}

function PermSection({
  title,
  badge,
  perms,
  values,
  onToggle,
  muted,
}: {
  title: string;
  badge?: string;
  perms: { key: string; label: string; description: string }[];
  values: Record<string, boolean>;
  onToggle: (key: string, val: boolean) => void;
  muted?: boolean;
}) {
  if (perms.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", muted ? "text-muted-foreground/60" : "text-muted-foreground")}>
          {title}
        </span>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{badge}</span>
        )}
      </div>
      <div className="space-y-2">
        {perms.map(p => (
          <div key={p.key} className="flex items-start gap-3">
            <PermToggle enabled={values[p.key] ?? false} onChange={v => onToggle(p.key, v)} />
            <div className="min-w-0">
              <div className="text-xs font-mono font-medium text-foreground leading-tight">{p.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  rolePerm,
  onChange,
}: {
  tool: (typeof TOOLS)[0];
  rolePerm: RoleToolPerm;
  onChange: (updated: RoleToolPerm) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { Icon, label, description, color, bg, graphPerms, internalPerms } = tool;
  const allPerms = [...graphPerms, ...internalPerms];
  const enabledCount = Object.values(rolePerm.perms).filter(Boolean).length;

  const updatePerm = (key: string, val: boolean) =>
    onChange({ ...rolePerm, perms: { ...rolePerm.perms, [key]: val } });

  const toggleAll = (val: boolean) => {
    const perms: Record<string, boolean> = {};
    for (const p of allPerms) perms[p.key] = val;
    onChange({ ...rolePerm, enabled: val, perms });
  };

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all",
      rolePerm.enabled ? "bg-card border-border shadow-sm" : "bg-muted/20 border-border/40"
    )}>
      <div className="flex items-start gap-3 p-4">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5", bg)}>
          <Icon size={17} className={rolePerm.enabled ? color : "text-muted-foreground"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("text-sm font-semibold leading-tight", rolePerm.enabled ? "text-foreground" : "text-muted-foreground")}>
            {label}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
        <PermToggle enabled={rolePerm.enabled} onChange={val => toggleAll(val)} />
      </div>

      {rolePerm.enabled && allPerms.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs border-t border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
          >
            <span className="font-medium">
              Permissions — {enabledCount}/{allPerms.length} active
            </span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {expanded && (
            <div className="px-4 pb-4 pt-3 space-y-4 border-t border-border/40 bg-muted/5">
              <PermSection
                title="Microsoft Graph API"
                badge="delegated"
                perms={graphPerms}
                values={rolePerm.perms}
                onToggle={updatePerm}
              />
              <PermSection
                title="Internal Access"
                perms={internalPerms}
                values={rolePerm.perms}
                onToggle={updatePerm}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Role = "boss" | "customer";

export default function BotSettings() {
  const { data: prefs, isLoading } = useBossPreferences();
  const { mutate: updatePrefs, isPending } = useUpdateBossPreferences();
  const botName = useBotName();
  const bossName = useBossName();
  const { toast } = useToast();

  const [bossPhone, setBossPhone] = useState("");
  const [config, setConfig] = useState<ToolConfig>(getDefaultConfig());
  const [activeTab, setActiveTab] = useState<Role>("boss");
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState("");
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState("");
  const [elevenLabsPhoneNumberId, setElevenLabsPhoneNumberId] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [voiceNoteVoiceId, setVoiceNoteVoiceId] = useState("");
  const [voiceNoteInstructions, setVoiceNoteInstructions] = useState("");
  const [voiceNoteCustomSettings, setVoiceNoteCustomSettings] = useState(false);
  const [voiceNoteStability, setVoiceNoteStability] = useState(0.50);
  const [voiceNoteSimilarityBoost, setVoiceNoteSimilarityBoost] = useState(0.80);
  const [voiceNoteStyle, setVoiceNoteStyle] = useState(0.00);
  const [voiceNoteSpeakerBoost, setVoiceNoteSpeakerBoost] = useState(true);
  const [voiceTestText, setVoiceTestText] = useState("");
  const [voiceTestLoading, setVoiceTestLoading] = useState(false);
  const [testCallNumber, setTestCallNumber] = useState("");
  const [testFirstMessage, setTestFirstMessage] = useState("");
  const [testCallLoading, setTestCallLoading] = useState(false);

  useEffect(() => {
    if (prefs) {
      const p = prefs as unknown as Record<string, unknown>;
      setBossPhone((p.bossPhone as string) ?? "");
      setConfig(parseConfig((p.toolConfig as string) ?? ""));
      setElevenLabsApiKey((p.elevenLabsApiKey as string) ?? "");
      setElevenLabsAgentId((p.elevenLabsAgentId as string) ?? "");
      setElevenLabsPhoneNumberId((p.elevenLabsPhoneNumberId as string) ?? "");
      setVoiceNoteVoiceId((p.voiceNoteVoiceId as string) ?? "");
      setVoiceNoteInstructions((p.voiceNoteInstructions as string) ?? "");
      const hasCustom = p.voiceNoteStability != null || p.voiceNoteSimilarityBoost != null || p.voiceNoteStyle != null;
      setVoiceNoteCustomSettings(!!hasCustom);
      if (hasCustom) {
        setVoiceNoteStability(typeof p.voiceNoteStability === "number" ? p.voiceNoteStability : 0.50);
        setVoiceNoteSimilarityBoost(typeof p.voiceNoteSimilarityBoost === "number" ? p.voiceNoteSimilarityBoost : 0.80);
        setVoiceNoteStyle(typeof p.voiceNoteStyle === "number" ? p.voiceNoteStyle : 0.00);
        setVoiceNoteSpeakerBoost(typeof p.voiceNoteSpeakerBoost === "boolean" ? p.voiceNoteSpeakerBoost : true);
      }
    }
  }, [prefs]);

  const updateTool = (key: string, role: Role, updated: RoleToolPerm) => {
    setConfig(prev => ({
      ...prev,
      [key]: { ...prev[key], [role]: updated },
    }));
  };

  const handleSave = () => {
    const bossTools = TOOLS.filter(t => config[t.key]?.boss.enabled).map(t => t.key).join(",");
    const customerTools = TOOLS.filter(t => config[t.key]?.customer.enabled).map(t => t.key).join(",");
    updatePrefs(
      {
        bossPhone, bossTools, customerTools, toolConfig: JSON.stringify(config),
        elevenLabsApiKey, elevenLabsAgentId, elevenLabsPhoneNumberId,
        voiceNoteVoiceId, voiceNoteInstructions,
        voiceNoteStability: voiceNoteCustomSettings ? voiceNoteStability : null,
        voiceNoteSimilarityBoost: voiceNoteCustomSettings ? voiceNoteSimilarityBoost : null,
        voiceNoteStyle: voiceNoteCustomSettings ? voiceNoteStyle : null,
        voiceNoteSpeakerBoost: voiceNoteCustomSettings ? voiceNoteSpeakerBoost : null,
      } as Parameters<typeof updatePrefs>[0],
      {
        onSuccess: () =>
          toast({ title: "Settings saved", description: `${botName} will use these permissions on the next call.` }),
        onError: () =>
          toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
      }
    );
  };

  const activeCount = (role: Role) => TOOLS.filter(t => config[t.key]?.[role].enabled).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading settings…
      </div>
    );
  }

  const roleConfig: Record<Role, { label: string; Icon: React.ElementType; color: string; accent: string; borderAccent: string }> = {
    boss: {
      label: "Boss Mode",
      Icon: ShieldCheck,
      color: "text-[#0078d4]",
      accent: "bg-[#0078d4]",
      borderAccent: "border-[#0078d4]",
    },
    customer: {
      label: "Customer Mode",
      Icon: User2,
      color: "text-slate-500",
      accent: "bg-slate-500",
      borderAccent: "border-slate-400",
    },
  };

  return (
    <div className="max-w-2xl mx-auto pb-16 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Assistant Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure tools and Microsoft Graph permissions separately for Boss and Customer mode.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0078d4] text-white text-sm font-semibold hover:bg-[#006cbe] disabled:opacity-50 transition-all shadow-md shadow-[#0078d4]/20 shrink-0"
        >
          {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save Changes
        </button>
      </div>

      {/* Boss Phone */}
      <div className="bg-card border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#0078d4]/10 flex items-center justify-center">
            <Phone size={15} className="text-[#0078d4]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Boss Phone Number</p>
            <p className="text-xs text-muted-foreground">{botName} checks this number to decide which mode to use.</p>
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="tel"
            value={bossPhone}
            onChange={e => setBossPhone(e.target.value)}
            placeholder="+1 (212) 555-1234"
            className="flex-1 min-w-[180px] max-w-xs px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#0078d4]/20 focus:border-[#0078d4]/40 font-mono"
          />
          {bossPhone ? (
            <span className="text-xs text-green-600 font-medium bg-green-500/10 px-3 py-1.5 rounded-lg">Boss detection active</span>
          ) : (
            <span className="text-xs text-amber-600 font-medium bg-amber-500/10 px-3 py-1.5 rounded-lg">All callers treated as customers</span>
          )}
        </div>
      </div>

      {/* ElevenLabs Voice Agent */}
      <div className="bg-card border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Mic2 size={15} className="text-purple-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">ElevenLabs Voice Agent</p>
            <p className="text-xs text-muted-foreground">Connect your ElevenLabs agent for inbound and outbound calls.</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API Key</label>
            <div className="relative flex items-center">
              <input
                type={showApiKey ? "text" : "password"}
                value={elevenLabsApiKey}
                onChange={e => setElevenLabsApiKey(e.target.value)}
                placeholder="sk_..."
                className="w-full pr-10 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(v => !v)}
                className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent ID</label>
            <input
              type="text"
              value={elevenLabsAgentId}
              onChange={e => setElevenLabsAgentId(e.target.value)}
              placeholder="e.g. agent_01jxxxxxxxxxxxxxxxx"
              className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Phone Number ID</label>
            <input
              type="text"
              value={elevenLabsPhoneNumberId}
              onChange={e => setElevenLabsPhoneNumberId(e.target.value)}
              placeholder="e.g. phnum_xxxxxxxxxxxxxxxx"
              className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 font-mono"
            />
          </div>
        </div>
        {elevenLabsAgentId && elevenLabsApiKey && elevenLabsPhoneNumberId ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-500/10 px-3 py-2 rounded-lg font-medium">
                <Mic2 size={12} /> Voice agent connected — inbound calls active
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await fetch("/api/elevenlabs/sync", { method: "POST" });
                    const d = await r.json() as { success?: boolean; promptLength?: number; error?: string };
                    if (!r.ok) throw new Error(d.error ?? "Sync failed");
                    toast({ title: "Agent synced", description: `Pushed ${d.promptLength?.toLocaleString()} chars of live instructions to ElevenLabs.` });
                  } catch (err) {
                    toast({ title: "Sync failed", description: String(err), variant: "destructive" });
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-purple-600 border border-purple-500/30 hover:bg-purple-500/10 transition-colors"
              >
                <Mic2 size={11} /> Sync Now
              </button>
            </div>
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Test Outbound Call</p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={testFirstMessage}
                  onChange={e => setTestFirstMessage(e.target.value)}
                  placeholder={`Opening line ${botName} will say when they pick up…`}
                  className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40"
                />
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={testCallNumber}
                    onChange={e => setTestCallNumber(e.target.value)}
                    placeholder="+1 (212) 555-1234"
                    className="flex-1 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 font-mono"
                  />
                  <button
                    type="button"
                    disabled={testCallLoading || !testCallNumber.trim()}
                    onClick={async () => {
                      setTestCallLoading(true);
                      try {
                        const r = await fetch("/api/elevenlabs/outbound-call", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            to_number: testCallNumber,
                            first_message: testFirstMessage.trim() || undefined,
                          }),
                        });
                        const data = await r.json() as { error?: string };
                        if (!r.ok) throw new Error(data.error ?? "Unknown error");
                        toast({ title: "Call initiated", description: `Dialing ${testCallNumber}…` });
                      } catch (err) {
                        toast({ title: "Call failed", description: String(err), variant: "destructive" });
                      } finally {
                        setTestCallLoading(false);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 transition-all shrink-0"
                  >
                    {testCallLoading ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
                    Dial
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{botName} will say the opening line the moment the call connects. Enter a number and click Dial to test.</p>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
            Enter all three fields and click Save Changes to activate.
          </div>
        )}
      </div>

      {/* WhatsApp Voice Notes */}
      <div className="bg-card border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-green-500/10 flex items-center justify-center">
            <MessageSquare size={15} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">WhatsApp Voice Notes</p>
            <p className="text-xs text-muted-foreground">Configure {botName}'s voice and behaviour when replying to WhatsApp audio messages.</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Voice ID</label>
            <input
              type="text"
              value={voiceNoteVoiceId}
              onChange={e => setVoiceNoteVoiceId(e.target.value)}
              placeholder="ElevenLabs voice ID (overrides agent default)"
              className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40 font-mono"
            />
            <p className="text-[11px] text-muted-foreground">Leave blank to use the voice from your ElevenLabs agent config.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reply Instructions</label>
            <textarea
              value={voiceNoteInstructions}
              onChange={e => setVoiceNoteInstructions(e.target.value)}
              placeholder="e.g. Keep replies concise and conversational — the customer is listening by audio."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40 resize-none"
            />
            <p className="text-[11px] text-muted-foreground">{botName} will follow these instructions when crafting voice note replies. Sent alongside the transcribed message.</p>
          </div>

          {/* TTS parameters */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">Voice Parameters</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Override the automatic language-aware defaults.</p>
              </div>
              <button
                type="button"
                onClick={() => setVoiceNoteCustomSettings(v => !v)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                  voiceNoteCustomSettings ? "bg-green-500" : "bg-muted"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md transform transition-transform",
                  voiceNoteCustomSettings ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>

            {voiceNoteCustomSettings && (
              <div className="space-y-4 pt-1">
                {([
                  { key: "stability", label: "Stability", value: voiceNoteStability, set: setVoiceNoteStability, hint: "Higher = more consistent but flatter. Lower = more expressive but less precise." },
                  { key: "similarity", label: "Similarity Boost", value: voiceNoteSimilarityBoost, set: setVoiceNoteSimilarityBoost, hint: "Higher = truer to the original voice character." },
                  { key: "style", label: "Style Exaggeration", value: voiceNoteStyle, set: setVoiceNoteStyle, hint: "Adds expressiveness. Keep at 0 for non-English languages to avoid distortion." },
                ] as { key: string; label: string; value: number; set: (v: number) => void; hint: string }[]).map(param => (
                  <div key={param.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">{param.label}</label>
                      <span className="text-xs font-mono font-semibold text-foreground w-10 text-right">{param.value.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0} max={1} step={0.01}
                      value={param.value}
                      onChange={e => param.set(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full accent-green-500 cursor-pointer"
                    />
                    <p className="text-[10px] text-muted-foreground">{param.hint}</p>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Speaker Boost</p>
                    <p className="text-[10px] text-muted-foreground">Enhances clarity on compressed audio like WhatsApp.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVoiceNoteSpeakerBoost(v => !v)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                      voiceNoteSpeakerBoost ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md transform transition-transform",
                      voiceNoteSpeakerBoost ? "translate-x-4" : "translate-x-0"
                    )} />
                  </button>
                </div>
              </div>
            )}

            {/* Live preview */}
            <div className="border-t pt-4 space-y-2">
              <p className="text-xs font-semibold text-foreground">Live Preview</p>
              <p className="text-[11px] text-muted-foreground">Type any text and play it with the current settings to hear exactly how it will sound.</p>
              <textarea
                value={voiceTestText}
                onChange={e => setVoiceTestText(e.target.value)}
                placeholder="Type something in Urdu, English, or any language…"
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500/40 resize-none"
              />
              <button
                type="button"
                disabled={voiceTestLoading || !voiceTestText.trim()}
                onClick={async () => {
                  setVoiceTestLoading(true);
                  try {
                    const body: Record<string, unknown> = { text: voiceTestText };
                    if (voiceNoteCustomSettings) {
                      body.stability = voiceNoteStability;
                      body.similarityBoost = voiceNoteSimilarityBoost;
                      body.style = voiceNoteStyle;
                      body.speakerBoost = voiceNoteSpeakerBoost;
                    }
                    const res = await fetch("/api/voice-note/test-tts", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                      const d = await res.json() as { error?: string };
                      throw new Error(d.error ?? "TTS failed");
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    audio.onended = () => URL.revokeObjectURL(url);
                    await audio.play();
                  } catch (err) {
                    toast({ title: "Preview failed", description: String(err), variant: "destructive" });
                  } finally {
                    setVoiceTestLoading(false);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition-all"
              >
                {voiceTestLoading
                  ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                  : <><Mic2 size={13} /> Play Preview</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl">
        {(["boss", "customer"] as Role[]).map(role => {
          const rc = roleConfig[role];
          const isActive = activeTab === role;
          return (
            <button
              key={role}
              onClick={() => setActiveTab(role)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <rc.Icon size={15} className={isActive ? rc.color : ""} />
              {rc.label}
              <span className={cn(
                "text-[11px] px-1.5 py-0.5 rounded-full font-medium",
                isActive ? `${rc.accent} text-white` : "bg-muted-foreground/20 text-muted-foreground"
              )}>
                {activeCount(role)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode description */}
      <div className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl border text-xs",
        activeTab === "boss"
          ? "bg-[#0078d4]/5 border-[#0078d4]/20 text-[#0078d4]"
          : "bg-muted/40 border-border text-muted-foreground"
      )}>
        {activeTab === "boss"
          ? <ShieldCheck size={15} className="shrink-0 mt-0.5" />
          : <User2 size={15} className="shrink-0 mt-0.5" />
        }
        <span>
          {activeTab === "boss"
            ? `Boss Mode activates when the caller's number matches your Boss Phone. Enable the tools ${botName} can use and the Graph API permissions she's allowed to exercise.`
            : "Customer Mode is the default for all unrecognized callers. Keep permissions minimal to protect your private data."
          }
        </span>
      </div>

      {/* Tool cards for active role */}
      <div className="space-y-3">
        {TOOLS.map(tool => (
          <ToolCard
            key={`${activeTab}-${tool.key}`}
            tool={tool}
            rolePerm={config[tool.key]?.[activeTab] ?? buildDefaultRolePerm(tool, false)}
            onChange={updated => updateTool(tool.key, activeTab, updated)}
          />
        ))}
      </div>

      {/* Info */}
      <div className="bg-muted/30 border rounded-2xl p-5 space-y-2">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">How it works</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When a call comes in, {botName} checks the caller's number against your Boss Phone. A match activates Boss Mode; otherwise Customer Mode is used. Only tools toggled on in the active mode — and only the Graph permissions you enable — are available during that call.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You can also adjust this via Brain — try <span className="font-medium text-foreground">"remove Teams send permission from boss"</span> or <span className="font-medium text-foreground">"set boss phone to +1..."</span>.
        </p>
      </div>
    </div>
  );
}
