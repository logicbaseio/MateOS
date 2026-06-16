import { useState, useEffect } from "react";
import { useBossPreferences, useUpdateBossPreferences, useBotName } from "@/hooks/use-preferences";
import { Save, Loader2, Sparkles, Clock, Globe, User, Calendar, Cpu, Eye, EyeOff } from "lucide-react";
import type { UpdatePreferencesBody } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const TIMEZONES: { group: string; zones: { value: string; label: string }[] }[] = [
  {
    group: "United States & Canada",
    zones: [
      { value: "America/New_York", label: "Eastern Time (ET) — New York, Miami, Toronto" },
      { value: "America/Chicago", label: "Central Time (CT) — Chicago, Dallas, Winnipeg" },
      { value: "America/Denver", label: "Mountain Time (MT) — Denver, Phoenix, Calgary" },
      { value: "America/Los_Angeles", label: "Pacific Time (PT) — Los Angeles, Seattle, Vancouver" },
      { value: "America/Anchorage", label: "Alaska Time (AKT) — Anchorage" },
      { value: "Pacific/Honolulu", label: "Hawaii Time (HT) — Honolulu" },
      { value: "America/Halifax", label: "Atlantic Time (AT) — Halifax, Puerto Rico" },
      { value: "America/St_Johns", label: "Newfoundland Time — St. John's" },
    ],
  },
  {
    group: "Latin America",
    zones: [
      { value: "America/Sao_Paulo", label: "Brazil Time (BRT) — São Paulo, Rio de Janeiro" },
      { value: "America/Argentina/Buenos_Aires", label: "Argentina Time — Buenos Aires" },
      { value: "America/Santiago", label: "Chile Time — Santiago" },
      { value: "America/Lima", label: "Peru Time — Lima, Bogotá, Quito" },
      { value: "America/Caracas", label: "Venezuela Time — Caracas" },
      { value: "America/Mexico_City", label: "Mexico City Time — Mexico City, Guadalajara" },
      { value: "America/Bogota", label: "Colombia Time — Bogotá" },
    ],
  },
  {
    group: "Europe",
    zones: [
      { value: "Europe/London", label: "GMT/BST — London, Dublin, Lisbon" },
      { value: "Europe/Paris", label: "Central European (CET) — Paris, Berlin, Rome, Madrid" },
      { value: "Europe/Amsterdam", label: "Central European (CET) — Amsterdam, Brussels" },
      { value: "Europe/Stockholm", label: "Central European (CET) — Stockholm, Oslo, Copenhagen" },
      { value: "Europe/Warsaw", label: "Central European (CET) — Warsaw, Prague, Vienna" },
      { value: "Europe/Helsinki", label: "Eastern European (EET) — Helsinki, Tallinn, Riga" },
      { value: "Europe/Athens", label: "Eastern European (EET) — Athens, Bucharest, Sofia" },
      { value: "Europe/Kiev", label: "Eastern European (EET) — Kyiv" },
      { value: "Europe/Istanbul", label: "Turkey Time (TRT) — Istanbul, Ankara" },
      { value: "Europe/Moscow", label: "Moscow Time (MSK) — Moscow, St. Petersburg" },
    ],
  },
  {
    group: "Middle East & Africa",
    zones: [
      { value: "Asia/Dubai", label: "Gulf Standard Time (GST) — Dubai, Abu Dhabi, Muscat" },
      { value: "Asia/Riyadh", label: "Arabia Standard Time — Riyadh, Kuwait, Baghdad" },
      { value: "Asia/Tehran", label: "Iran Time (IRST) — Tehran" },
      { value: "Africa/Cairo", label: "Eastern Europe Time — Cairo, Beirut, Amman" },
      { value: "Africa/Johannesburg", label: "South Africa Time (SAST) — Johannesburg, Cape Town" },
      { value: "Africa/Lagos", label: "West Africa Time (WAT) — Lagos, Accra, Nairobi" },
      { value: "Africa/Nairobi", label: "East Africa Time (EAT) — Nairobi, Addis Ababa" },
      { value: "Indian/Mauritius", label: "Mauritius Time — Mauritius, Réunion" },
    ],
  },
  {
    group: "South & Central Asia",
    zones: [
      { value: "Asia/Karachi", label: "Pakistan Standard Time (PKT) — Karachi, Lahore, Islamabad" },
      { value: "Asia/Kolkata", label: "India Standard Time (IST) — Mumbai, Delhi, Bangalore" },
      { value: "Asia/Dhaka", label: "Bangladesh Time (BST) — Dhaka" },
      { value: "Asia/Colombo", label: "Sri Lanka Time — Colombo" },
      { value: "Asia/Kathmandu", label: "Nepal Time — Kathmandu" },
      { value: "Asia/Almaty", label: "Kazakhstan Time — Almaty, Astana" },
      { value: "Asia/Tashkent", label: "Uzbekistan Time — Tashkent" },
    ],
  },
  {
    group: "East & Southeast Asia",
    zones: [
      { value: "Asia/Bangkok", label: "Indochina Time (ICT) — Bangkok, Jakarta, Hanoi" },
      { value: "Asia/Singapore", label: "Singapore Time (SGT) — Singapore, Kuala Lumpur" },
      { value: "Asia/Hong_Kong", label: "Hong Kong Time (HKT) — Hong Kong" },
      { value: "Asia/Shanghai", label: "China Standard Time (CST) — Beijing, Shanghai" },
      { value: "Asia/Taipei", label: "Taiwan Time (TST) — Taipei" },
      { value: "Asia/Seoul", label: "Korea Standard Time (KST) — Seoul, Busan" },
      { value: "Asia/Tokyo", label: "Japan Standard Time (JST) — Tokyo, Osaka" },
      { value: "Asia/Manila", label: "Philippine Time (PHT) — Manila, Cebu" },
      { value: "Asia/Rangoon", label: "Myanmar Time (MMT) — Yangon" },
    ],
  },
  {
    group: "Oceania",
    zones: [
      { value: "Australia/Perth", label: "Australian Western Time (AWST) — Perth" },
      { value: "Australia/Adelaide", label: "Australian Central Time (ACST) — Adelaide, Darwin" },
      { value: "Australia/Sydney", label: "Australian Eastern Time (AEST) — Sydney, Melbourne" },
      { value: "Australia/Brisbane", label: "Australian Eastern Time — Brisbane, Queensland" },
      { value: "Pacific/Auckland", label: "New Zealand Time (NZST) — Auckland, Wellington" },
      { value: "Pacific/Fiji", label: "Fiji Time — Suva" },
      { value: "Pacific/Guam", label: "Chamorro Time — Guam, Saipan" },
    ],
  },
  {
    group: "UTC / Fixed Offsets",
    zones: [
      { value: "UTC", label: "UTC — Coordinated Universal Time" },
      { value: "Etc/GMT+12", label: "UTC−12:00 — Baker Island" },
      { value: "Etc/GMT+5", label: "UTC−05:00" },
      { value: "Etc/GMT+3", label: "UTC−03:00" },
      { value: "Etc/GMT", label: "UTC±00:00" },
      { value: "Etc/GMT-1", label: "UTC+01:00" },
      { value: "Etc/GMT-3", label: "UTC+03:00" },
      { value: "Etc/GMT-5", label: "UTC+05:00" },
      { value: "Etc/GMT-8", label: "UTC+08:00" },
      { value: "Etc/GMT-12", label: "UTC+12:00" },
    ],
  },
];

const MOOD_OPTIONS = [
  { value: "available", label: "Available & Social", emoji: "🟢", description: "Accept most meetings" },
  { value: "flexible", label: "Flexible", emoji: "🟡", description: "Important meetings only" },
  { value: "busy", label: "Busy", emoji: "🟠", description: "Heads-down, minimize interruptions" },
  { value: "do_not_disturb", label: "Do Not Disturb", emoji: "🔴", description: "No meetings at all" },
];

const PREFERRED_TIME_OPTIONS = [
  { value: "morning", label: "☀️ Morning", description: "9 AM – 12 PM" },
  { value: "afternoon", label: "🌤️ Afternoon", description: "1 PM – 5 PM" },
  { value: "evening", label: "🌆 Evening", description: "5 PM – 8 PM" },
  { value: "night", label: "🌙 Night", description: "8 PM – 12 AM" },
];

export default function Preferences() {
  const { data: prefs, isLoading } = useBossPreferences();
  const { mutate: updatePrefs, isPending } = useUpdateBossPreferences();
  const { toast } = useToast();
  const botName = useBotName();

  const [formData, setFormData] = useState<UpdatePreferencesBody & { workdayStart?: string; workdayEnd?: string; botName?: string }>({});
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (prefs) {
      setFormData({
        bossName: prefs.bossName,
        botName: (prefs as any).botName ?? "Mate",
        timezone: prefs.timezone,
        currentCity: prefs.currentCity,
        mood: prefs.mood,
        preferredMeetingTime: prefs.preferredMeetingTime,
        maxMeetingsPerDay: prefs.maxMeetingsPerDay,
        meetingDurationMinutes: prefs.meetingDurationMinutes,
        breakBetweenMeetings: prefs.breakBetweenMeetings,
        notes: prefs.notes,
        workdayStart: (prefs as any).workdayStart ?? "09:00",
        workdayEnd: (prefs as any).workdayEnd ?? "17:00",
        customLlmProvider: (prefs as any).customLlmProvider ?? "replit",
        customLlmApiKey: (prefs as any).customLlmApiKey ?? "",
        customLlmModel: (prefs as any).customLlmModel ?? "",
        customLlmBaseUrl: (prefs as any).customLlmBaseUrl ?? "",
      });
    }
  }, [prefs]);

  const handleSubmit = () => {
    updatePrefs(formData as UpdatePreferencesBody, {
      onSuccess: () => {
        toast({ title: "Preferences saved", description: "AI Scheduler will now use these rules." });
      },
      onError: () => {
        toast({ title: "Error saving preferences", variant: "destructive" });
      },
    });
  };

  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 text-muted-foreground gap-3">
        <Loader2 className="animate-spin" size={20} />
        Loading preferences…
      </div>
    );
  }

  const currentMood = MOOD_OPTIONS.find(m => m.value === formData.mood);

  return (
    <div className="max-w-4xl mx-auto pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">MateOS Scheduling Rules</h1>
          <p className="text-muted-foreground mt-1">Configure how the assistant manages your calendar, bookings, and appointments.</p>
        </div>
        <Button onClick={handleSubmit} disabled={isPending} size="lg" className="shrink-0 gap-2">
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* General Context */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <User size={16} className="text-muted-foreground" />
                General Context
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label>AI Assistant Name</Label>
                  <Input
                    value={(formData as any).botName || ""}
                    onChange={e => setFormData(prev => ({ ...prev, botName: e.target.value }))}
                    placeholder="e.g. Mate"
                  />
                  <p className="text-xs text-muted-foreground">The name your AI assistant uses when talking to customers.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label>Current City</Label>
                  <Input
                    value={formData.currentCity || ""}
                    onChange={e => set("currentCity", e.target.value)}
                    placeholder="e.g. New York"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Globe size={13} className="text-muted-foreground" />
                    Timezone
                  </Label>
                  <Select value={formData.timezone || ""} onValueChange={v => set("timezone", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select timezone…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {TIMEZONES.map(group => (
                        <SelectGroup key={group.group}>
                          <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {group.group}
                          </SelectLabel>
                          {group.zones.map(tz => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Current Mood</Label>
                  <Select value={formData.mood || ""} onValueChange={v => set("mood", v as any)}>
                    <SelectTrigger>
                      <SelectValue>
                        {currentMood && (
                          <span className="flex items-center gap-2">
                            <span>{currentMood.emoji}</span>
                            <span>{currentMood.label}</span>
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MOOD_OPTIONS.map(mood => (
                        <SelectItem key={mood.value} value={mood.value}>
                          <div className="flex items-center gap-2.5">
                            <span className="text-base leading-none">{mood.emoji}</span>
                            <div>
                              <div className="font-medium">{mood.label}</div>
                              <div className="text-xs text-muted-foreground">{mood.description}</div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timing Preferences */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Clock size={16} className="text-muted-foreground" />
                Timing Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Appointment Window */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Appointment Window</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Daily time range {botName} can book meetings — in your local timezone.
                  </p>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs text-muted-foreground font-normal">From</Label>
                    <Input
                      type="time"
                      value={formData.workdayStart || "09:00"}
                      onChange={e => set("workdayStart" as any, e.target.value)}
                    />
                  </div>
                  <span className="pb-2.5 text-muted-foreground font-medium select-none">–</span>
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs text-muted-foreground font-normal">To</Label>
                    <Input
                      type="time"
                      value={formData.workdayEnd || "17:00"}
                      onChange={e => set("workdayEnd" as any, e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label>Preferred Time of Day</Label>
                  <Select value={formData.preferredMeetingTime || ""} onValueChange={v => set("preferredMeetingTime", v as any)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select preference…" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_TIME_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <span>{opt.label}</span>
                            <span className="text-xs text-muted-foreground">{opt.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Max Meetings / Day</Label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={formData.maxMeetingsPerDay ?? ""}
                    onChange={e => set("maxMeetingsPerDay", parseInt(e.target.value) || 0)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Default Duration (mins)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={15}
                    value={formData.meetingDurationMinutes ?? ""}
                    onChange={e => set("meetingDurationMinutes", parseInt(e.target.value) || 0)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Buffer Between Meetings (mins)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    value={formData.breakBetweenMeetings ?? ""}
                    onChange={e => set("breakBetweenMeetings", parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          {/* AI Model Configuration */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Cpu size={16} className="text-muted-foreground" />
                AI Model
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                By default, MateOS uses the built-in AI. You can switch to your own API key from OpenAI, OpenRouter, or any compatible provider.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={(formData as any).customLlmProvider ?? "replit"}
                  onValueChange={v => setFormData(prev => ({ ...prev, customLlmProvider: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replit">
                      <div>
                        <div className="font-medium">Default (Built-in)</div>
                        <div className="text-xs text-muted-foreground">No API key required</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="openai">
                      <div>
                        <div className="font-medium">OpenAI</div>
                        <div className="text-xs text-muted-foreground">GPT-4o, GPT-4.1, o3, etc.</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="openrouter">
                      <div>
                        <div className="font-medium">OpenRouter</div>
                        <div className="text-xs text-muted-foreground">Access Claude, Gemini, Llama & more via one key</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="custom">
                      <div>
                        <div className="font-medium">Custom</div>
                        <div className="text-xs text-muted-foreground">Any OpenAI-compatible endpoint</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(formData as any).customLlmProvider && (formData as any).customLlmProvider !== "replit" && (
                <>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={(formData as any).customLlmApiKey ?? ""}
                        onChange={e => setFormData(prev => ({ ...prev, customLlmApiKey: e.target.value }))}
                        placeholder={
                          (formData as any).customLlmProvider === "openai" ? "sk-..." :
                          (formData as any).customLlmProvider === "openrouter" ? "sk-or-..." :
                          "Your API key"
                        }
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {(formData as any).customLlmProvider === "openrouter" && (
                      <p className="text-xs text-muted-foreground">
                        Get your key at <span className="font-mono">openrouter.ai/keys</span>. OpenRouter lets you use Claude, Gemini, Llama, and more.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Model Name</Label>
                    <Input
                      value={(formData as any).customLlmModel ?? ""}
                      onChange={e => setFormData(prev => ({ ...prev, customLlmModel: e.target.value }))}
                      placeholder={
                        (formData as any).customLlmProvider === "openai" ? "gpt-4o" :
                        (formData as any).customLlmProvider === "openrouter" ? "anthropic/claude-opus-4" :
                        "gpt-4o"
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {(formData as any).customLlmProvider === "openrouter"
                        ? "Use OpenRouter model IDs like anthropic/claude-opus-4, google/gemini-2.5-pro, meta-llama/llama-3.1-70b-instruct"
                        : "Enter the exact model name as shown in your provider's docs."}
                    </p>
                  </div>

                  {(formData as any).customLlmProvider === "custom" && (
                    <div className="space-y-2">
                      <Label>Base URL</Label>
                      <Input
                        value={(formData as any).customLlmBaseUrl ?? ""}
                        onChange={e => setFormData(prev => ({ ...prev, customLlmBaseUrl: e.target.value }))}
                        placeholder="https://api.example.com/v1"
                      />
                      <p className="text-xs text-muted-foreground">The base URL of any OpenAI-compatible API endpoint.</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-primary">
                <Sparkles size={16} />
                AI Instructions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={formData.notes || ""}
                onChange={e => set("notes", e.target.value)}
                placeholder="e.g. Always ask me before scheduling meetings on Fridays. Decline anyone named John unless marked urgent."
                className="h-52 resize-none bg-background/60 border-primary/20 focus:border-primary placeholder:text-muted-foreground/50"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                The bot reads these instructions during every scheduling conversation. You can also update them by chatting with the Brain.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar size={16} className="text-muted-foreground" />
                Current Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Timezone</span>
                <span className="text-foreground font-medium text-right max-w-[60%] truncate">
                  {TIMEZONES.flatMap(g => g.zones).find(z => z.value === formData.timezone)?.label?.split(" — ")[0] || formData.timezone || "—"}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Window</span>
                <span className="text-foreground font-medium">
                  {formData.workdayStart || "09:00"} – {formData.workdayEnd || "17:00"}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Mood</span>
                <span className="text-foreground font-medium">
                  {currentMood ? `${currentMood.emoji} ${currentMood.label}` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Max / day</span>
                <span className="text-foreground font-medium">{formData.maxMeetingsPerDay ?? "—"}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Duration</span>
                <span className="text-foreground font-medium">{formData.meetingDurationMinutes ? `${formData.meetingDurationMinutes} min` : "—"}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Buffer</span>
                <span className="text-foreground font-medium">{formData.breakBetweenMeetings ? `${formData.breakBetweenMeetings} min` : "—"}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
