import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

type NavDivider = { kind: "divider"; label: string };
type NavLink = { kind: "link"; label: string; href: string; icon: string; accent?: true };
type NavEntry = NavDivider | NavLink;

const ICON_BASE = "https://img.icons8.com/sf-regular/96";

const NAV_ITEMS: NavEntry[] = [
  { kind: "link", label: "Brain", href: "/brain", icon: `${ICON_BASE}/brain.png`, accent: true },
  { kind: "link", label: "Approvals", href: "/approvals", icon: `${ICON_BASE}/checked-checkbox.png` },
  { kind: "link", label: "Integrations", href: "/integrations", icon: `${ICON_BASE}/plugin.png` },
  { kind: "link", label: "Channels", href: "/channels", icon: `${ICON_BASE}/radio-tower.png` },
  { kind: "link", label: "Dashboard", href: "/", icon: `${ICON_BASE}/overview-pages-3.png` },
  { kind: "divider", label: "Front Desk" },
  { kind: "link", label: "Preferences", href: "/scheduling/preferences", icon: `${ICON_BASE}/settings.png` },
  { kind: "link", label: "Meeting Requests", href: "/scheduling/requests", icon: `${ICON_BASE}/calendar.png` },
  { kind: "link", label: "Customers", href: "/scheduling/customers", icon: `${ICON_BASE}/conference-call.png` },
  { kind: "link", label: "Assistant Chat", href: "/scheduling/chat", icon: `${ICON_BASE}/headphones.png` },
  { kind: "link", label: "Soul", href: "/scheduling/soul", icon: `${ICON_BASE}/star.png` },
  { kind: "link", label: "Assistant Settings", href: "/scheduling/bot-settings", icon: `${ICON_BASE}/key.png` },
  { kind: "link", label: "Owner Memory", href: "/scheduling/memory", icon: `${ICON_BASE}/brain.png` },
  { kind: "divider", label: "Operations" },
  { kind: "link", label: "Alert Inbox", href: "/amazon/alerts", icon: `${ICON_BASE}/alarm.png` },
  { kind: "link", label: "Team Channels", href: "/amazon/channels", icon: `${ICON_BASE}/conference-call.png` },
  { kind: "link", label: "Email Simulator", href: "/amazon/simulator", icon: `${ICON_BASE}/email.png` },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/brain": "Brain",
  "/channels": "Channels",
  "/approvals": "Approvals",
  "/integrations": "Integrations",
  "/scheduling/preferences": "Preferences",
  "/scheduling/requests": "Meeting Requests",
  "/scheduling/customers": "Customers",
  "/scheduling/chat": "Assistant Chat",
  "/scheduling/soul": "Soul",
  "/scheduling/bot-settings": "Assistant Settings",
  "/scheduling/memory": "Owner Memory",
  "/amazon/alerts": "Alert Inbox",
  "/amazon/channels": "Team Channels",
  "/amazon/simulator": "Email Simulator",
};

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDark] = useState(true);
  const [pendingNotifications, setPendingNotifications] = useState(0);

  useEffect(() => {
    const fetchNotifCount = () => {
      fetch("/api/channels/notifications")
        .then((r) => r.json())
        .then((d: { pendingCount?: number }) => setPendingNotifications(d.pendingCount ?? 0))
        .catch(() => { /* ignore */ });
    };
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location]);

  const pageTitle = PAGE_TITLES[location] ?? (location.startsWith("/scheduling/customers/") ? "Customer Profile" : "MateOS");

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 h-[46px] hidden md:flex items-center gap-2 border-b border-border shrink-0">
        <img src="/mateos-logo.png" alt="MateOS" className="h-8 w-auto" />
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {NAV_ITEMS.map((item, idx) => {
          if (item.kind === "divider") {
            return (
              <div key={idx} className="pt-5 pb-1.5 px-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {item.label}
                </p>
              </div>
            );
          }

          const isActive = location === item.href;
          const isAccent = item.accent === true;
          const isApprovals = item.href === "/approvals";
          const showBadge = isApprovals && pendingNotifications > 0;

          return (
            <Link key={idx} href={item.href} className="block">
              <div className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors duration-150 group cursor-pointer text-sm",
                isActive
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}>
                <img
                  src={item.icon}
                  alt=""
                  width={18}
                  height={18}
                  className={cn(
                    "shrink-0 transition-opacity duration-150",
                    isDark ? "invert" : "",
                    isActive ? "opacity-80" : "opacity-50 group-hover:opacity-70"
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {isAccent && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    AI
                  </span>
                )}
                {showBadge && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold px-1 rounded-full bg-[#0078d4] text-white">
                    {pendingNotifications}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row overflow-hidden">
      
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card z-20">
        <img src="/mateos-logo.png" alt="MateOS" className="h-7 w-auto" />
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-60 bg-card border-r border-border shrink-0">
        <SidebarContent />
      </aside>

      {/* Sidebar Mobile */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.aside
            initial={{ x: -240, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -240, opacity: 0 }}
            transition={{ type: "tween", duration: 0.2 }}
            className="fixed inset-y-0 left-0 z-40 w-60 bg-card border-r border-border flex flex-col md:hidden"
          >
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Bar */}
        <div className="hidden md:flex items-center px-6 h-[46px] border-b border-border bg-card shrink-0">
          <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="p-4 md:p-8"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </div>
  );
}
