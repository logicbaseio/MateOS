import { useDashboardStats } from "@/hooks/use-dashboard";
import { useBossPreferences } from "@/hooks/use-preferences";
import { motion } from "framer-motion";
import {
  BellRing,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  MessagesSquare,
  Network,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STAT_CONFIGS = [
  { key: "pendingMeetings", label: "Pending Requests", icon: CalendarDays, color: "text-warning", bg: "bg-warning/10" },
  { key: "todaysMeetings", label: "Meetings Today", icon: Clock, color: "text-primary", bg: "bg-primary/10" },
  { key: "activeAlerts", label: "Active Alerts", icon: BellRing, color: "text-destructive", bg: "bg-destructive/10" },
  { key: "resolvedAlerts", label: "Resolved Alerts", icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
  { key: "totalConversations", label: "Assistant Conversations", icon: MessagesSquare, color: "text-accent", bg: "bg-accent/10" },
  { key: "teamChannels", label: "Mapped Channels", icon: Network, color: "text-secondary-foreground", bg: "bg-secondary" },
];

const INDUSTRIES = [
  {
    title: "Restaurants and Food",
    description: "Handle reservations, takeaway orders, table changes, and customer follow-ups.",
    icon: Building2,
  },
  {
    title: "Dental and Doctors",
    description: "Manage bookings, reminders, intake questions, and front-desk triage.",
    icon: Stethoscope,
  },
  {
    title: "Coaches and Consultants",
    description: "Qualify leads, protect calendar time, and convert inquiries into booked sessions.",
    icon: Briefcase,
  },
];

export default function Dashboard() {
  const { data: stats, isLoading, error } = useDashboardStats();
  const { data: prefs } = useBossPreferences();

  if (error) return <div className="p-8 text-destructive">Failed to load dashboard stats.</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <div className="relative overflow-hidden rounded-3xl bg-card border shadow-xl shadow-black/5">
        <img 
          src={`${import.meta.env.BASE_URL}images/dashboard-hero.png`}
          alt="Dashboard Hero"
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay pointer-events-none"
        />
        <div className="relative p-8 md:p-12 z-10">
          <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground">
            MateOS for <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">{prefs?.bossName ?? "your team"}</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Your open-source assistant workspace is live. You have
            <strong className="text-foreground mx-1">{stats?.pendingMeetings || 0}</strong> meeting requests pending and
            <strong className="text-foreground mx-1">{stats?.activeAlerts || 0}</strong> active alerts requiring attention.
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-display font-semibold mb-6">System Overview</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {STAT_CONFIGS.map((config, idx) => {
            const Icon = config.icon;
            const val = stats ? (stats as any)[config.key] : 0;
            
            return (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                key={config.key}
                className="bg-card p-6 rounded-3xl border shadow-lg shadow-black/5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-muted-foreground font-medium mb-2">{config.label}</p>
                    {isLoading ? (
                      <div className="h-10 w-20 bg-muted animate-pulse rounded-lg" />
                    ) : (
                      <h3 className="text-4xl font-display font-bold text-foreground">{val}</h3>
                    )}
                  </div>
                  <div className={cn("p-4 rounded-2xl", config.bg, config.color)}>
                    <Icon size={28} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-display font-semibold mb-6">Starter Verticals</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {INDUSTRIES.map(({ title, description, icon: Icon }) => (
            <div key={title} className="bg-card p-6 rounded-3xl border shadow-lg shadow-black/5">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                <Icon size={22} />
              </div>
              <h3 className="text-xl font-display font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
