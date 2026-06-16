import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBotName, useBossName } from "@/hooks/use-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Brain,
  MapPin,
  Plane,
  Clock,
  MessageSquare,
  Briefcase,
  Users,
  Heart,
  ShieldCheck,
  Activity,
  Zap,
  User,
  AlertCircle,
  Star,
  RefreshCw,
  Bot,
} from "lucide-react";

interface BossMemory {
  id: number;
  section: string;
  key: string;
  value: string;
  tags: string[];
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

type GroupedMemories = Record<string, BossMemory[]>;

const SECTIONS = [
  "identity",
  "location",
  "travel",
  "schedule",
  "communication",
  "work",
  "people",
  "preferences",
  "rules",
  "health",
  "current",
] as const;

const SECTION_ICONS: Record<string, ReactNode> = {
  identity: <User className="w-4 h-4" />,
  location: <MapPin className="w-4 h-4" />,
  travel: <Plane className="w-4 h-4" />,
  schedule: <Clock className="w-4 h-4" />,
  communication: <MessageSquare className="w-4 h-4" />,
  work: <Briefcase className="w-4 h-4" />,
  people: <Users className="w-4 h-4" />,
  preferences: <Heart className="w-4 h-4" />,
  rules: <ShieldCheck className="w-4 h-4" />,
  health: <Activity className="w-4 h-4" />,
  current: <Zap className="w-4 h-4" />,
};

const SECTION_ACCENT: Record<string, string> = {
  identity: "text-violet-400",
  location: "text-blue-400",
  travel: "text-sky-400",
  schedule: "text-green-400",
  communication: "text-yellow-400",
  work: "text-orange-400",
  people: "text-pink-400",
  preferences: "text-indigo-400",
  rules: "text-red-400",
  health: "text-emerald-400",
  current: "text-amber-400",
};

const TAG_ACCENT: Record<string, string> = {
  identity: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  location: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  travel: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  schedule: "bg-green-500/20 text-green-300 border-green-500/40",
  communication: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  work: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  people: "bg-pink-500/20 text-pink-300 border-pink-500/40",
  preferences: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  rules: "bg-red-500/20 text-red-300 border-red-500/40",
  health: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  current: "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

function ImportanceBadge({ importance }: { importance: number }) {
  if (importance === 3)
    return (
      <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
        <AlertCircle className="w-3 h-3" /> Critical
      </span>
    );
  if (importance === 2)
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-400 font-medium">
        <Star className="w-3 h-3" /> Important
      </span>
    );
  return null;
}

interface PersonaData {
  persona: string;
  updatedAt: string | null;
}

export default function BossMemory() {
  const botName = useBotName();
  const bossName = useBossName();
  const [filterSection, setFilterSection] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: grouped = {}, isLoading } = useQuery<GroupedMemories>({
    queryKey: ["/api/boss-memory"],
    queryFn: () => fetch("/api/boss-memory").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const { data: personaData } = useQuery<PersonaData>({
    queryKey: ["/api/boss-persona"],
    queryFn: () => fetch("/api/boss-persona").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const handleRefreshPersona = async () => {
    setIsRefreshing(true);
    try {
      await fetch("/api/boss-persona/refresh", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["/api/boss-persona"] });
    } finally {
      setIsRefreshing(false);
    }
  };

  const allMemories = Object.values(grouped).flat();
  const totalMemories = allMemories.length;
  const criticalCount = allMemories.filter((m) => m.importance === 3).length;
  const sectionCount = Object.keys(grouped).length;

  const filteredEntries =
    filterSection === "all"
      ? Object.entries(grouped)
      : Object.entries(grouped).filter(([s]) => s === filterSection);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6 text-violet-400" />
          Boss Memory
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          What the Brain knows about you
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">{totalMemories}</div>
            <div className="text-xs text-muted-foreground mt-1">Total memories</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">{sectionCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Active sections</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold text-red-400">{criticalCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Critical rules</div>
          </CardContent>
        </Card>
      </div>

      {/* Boss Persona Panel */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-400" />
              {botName}'s Boss Persona
              <Badge variant="outline" className="text-[10px] font-normal border-blue-500/30 text-blue-400 ml-1">
                Auto-maintained
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-3">
              {personaData?.updatedAt && (
                <span className="text-[11px] text-muted-foreground">
                  Updated {new Date(personaData.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <button
                onClick={handleRefreshPersona}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all disabled:opacity-40"
              >
                <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            What {botName} reads before every customer call — curated from memory by Brain, optimized for scheduling decisions
          </p>
        </CardHeader>
        <CardContent>
          {personaData?.persona ? (
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed bg-background/50 rounded-xl p-4 border border-border/50 max-h-64 overflow-y-auto">
              {personaData.persona}
            </pre>
          ) : (
            <div className="text-xs text-muted-foreground italic py-4 text-center">
              No persona generated yet — Brain will create one when you add memory
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Filter by section:</Label>
        <Select value={filterSection} onValueChange={setFilterSection}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {SECTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="capitalize">{s}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12 text-sm">
          Loading memories...
        </div>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <Brain className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
            <p className="text-muted-foreground text-sm">
              No memories yet. Chat with the Brain — it will learn and remember
              everything automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map(([sectionName, items]) => (
            <Card key={sectionName}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className={SECTION_ACCENT[sectionName] ?? "text-muted-foreground"}>
                    {SECTION_ICONS[sectionName] ?? <Brain className="w-4 h-4" />}
                  </span>
                  <span className="capitalize">{sectionName}</span>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((memory, i) => (
                  <div key={memory.id}>
                    {i > 0 && <Separator className="mb-3" />}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                          {memory.key}
                        </code>
                        <ImportanceBadge importance={memory.importance} />
                        <Badge
                          variant="outline"
                          className="ml-auto text-xs capitalize"
                        >
                          {memory.source}
                        </Badge>
                      </div>
                      <p className="text-sm leading-relaxed">{memory.value}</p>
                      {memory.tags && memory.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {memory.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`text-xs px-2 py-0.5 rounded-full border ${
                                TAG_ACCENT[sectionName] ??
                                "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
