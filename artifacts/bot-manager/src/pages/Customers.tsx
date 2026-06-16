import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Building2, User, TrendingUp, Calendar, ChevronRight, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type SortField = "name" | "tier" | "totalRevenue" | "meetingCount" | "lastContactAt";
type SortDir = "asc" | "desc";

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  tier: string;
  totalRevenue: string;
  currency: string;
  status: string;
  notes: string | null;
  firstContactAt: string;
  lastContactAt: string;
  meetingCount: number;
}

const TIER_COLORS: Record<string, string> = {
  new: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  regular: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  vip: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  premium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const TIER_LABELS: Record<string, string> = {
  new: "New",
  regular: "Regular",
  vip: "VIP",
  premium: "Premium",
};

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={cn(
      "px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded border",
      TIER_COLORS[tier] ?? TIER_COLORS.new
    )}>
      {TIER_LABELS[tier] ?? tier}
    </span>
  );
}

function formatRevenue(revenue: string | number, currency: string) {
  const num = parseFloat(String(revenue));
  if (isNaN(num)) return `${currency} 0.00`;
  return `${currency} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface NewCustomerForm {
  name: string;
  email: string;
  phone: string;
  company: string;
  tier: string;
  notes: string;
}

const TIER_ORDER: Record<string, number> = { new: 0, regular: 1, vip: 2, premium: 3 };

function SortableHeader({
  label,
  field,
  currentSort,
  currentDir,
  onClick,
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDir: SortDir;
  onClick: (f: SortField) => void;
}) {
  const isActive = currentSort === field;
  return (
    <th
      className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onClick(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <ArrowUpDown size={11} className="opacity-30" />
        )}
      </span>
    </th>
  );
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState<SortField>("lastContactAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showNewModal, setShowNewModal] = useState(false);
  const [form, setForm] = useState<NewCustomerForm>({
    name: "",
    email: "",
    phone: "",
    company: "",
    tier: "new",
    notes: "",
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (tierFilter) queryParams.set("tier", tierFilter);
  if (statusFilter) queryParams.set("status", statusFilter);
  const queryString = queryParams.toString();

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ["customers", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/customers?${queryString}` : "/api/customers";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json() as Promise<Customer[]>;
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedCustomers = useMemo(() => {
    if (!customers) return [];
    return [...customers].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "tier") cmp = (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0);
      else if (sortField === "totalRevenue") cmp = parseFloat(String(a.totalRevenue)) - parseFloat(String(b.totalRevenue));
      else if (sortField === "meetingCount") cmp = a.meetingCount - b.meetingCount;
      else if (sortField === "lastContactAt") cmp = new Date(a.lastContactAt).getTime() - new Date(b.lastContactAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [customers, sortField, sortDir]);

  const createCustomer = useMutation({
    mutationFn: async (data: NewCustomerForm) => {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to create customer");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowNewModal(false);
      setForm({ name: "", email: "", phone: "", company: "", tier: "new", notes: "" });
      toast({ title: "Customer created" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    createCustomer.mutate(form);
  };

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Customers</h1>
          <p className="text-muted-foreground mt-1">Track everyone who contacts or books through MateOS.</p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} />
          New Customer
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, email, or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="">All Tiers</option>
          <option value="new">New</option>
          <option value="regular">Regular</option>
          <option value="vip">VIP</option>
          <option value="premium">Premium</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading customers...</div>
      ) : sortedCustomers.length === 0 ? (
        <div className="text-center py-16 bg-card border border-dashed rounded-3xl">
          <User size={40} className="mx-auto text-muted-foreground mb-3 opacity-40" />
          <p className="text-muted-foreground font-medium">No customers found.</p>
          <p className="text-muted-foreground/60 text-sm mt-1">Create your first customer to get started.</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <SortableHeader label="Customer" field="name" currentSort={sortField} currentDir={sortDir} onClick={handleSort} />
                  <SortableHeader label="Tier" field="tier" currentSort={sortField} currentDir={sortDir} onClick={handleSort} />
                  <SortableHeader label="Revenue" field="totalRevenue" currentSort={sortField} currentDir={sortDir} onClick={handleSort} />
                  <SortableHeader label="Meetings" field="meetingCount" currentSort={sortField} currentDir={sortDir} onClick={handleSort} />
                  <SortableHeader label="Last Contact" field="lastContactAt" currentSort={sortField} currentDir={sortDir} onClick={handleSort} />
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {sortedCustomers.map((customer, idx) => (
                  <tr
                    key={customer.id}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/30 transition-colors",
                      idx === sortedCustomers.length - 1 && "border-b-0"
                    )}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User size={14} className="text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{customer.name}</p>
                          <p className="text-xs text-muted-foreground">{customer.email}</p>
                          {customer.company && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building2 size={10} />
                              {customer.company}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <TierBadge tier={customer.tier} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-foreground font-medium">
                        <TrendingUp size={14} className="text-muted-foreground" />
                        {formatRevenue(customer.totalRevenue, customer.currency)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar size={13} />
                        {customer.meetingCount}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">
                      {formatDate(customer.lastContactAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link href={`/scheduling/customers/${customer.id}`}>
                        <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                          View <ChevronRight size={13} />
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">New Customer</h2>
              <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 555 000 0000"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="Acme Corp"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Tier</label>
                <select
                  value={form.tier}
                  onChange={(e) => setForm(f => ({ ...f, tier: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                >
                  <option value="new">New</option>
                  <option value="regular">Regular</option>
                  <option value="vip">VIP</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 pt-0">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createCustomer.isPending}
                className="px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {createCustomer.isPending ? "Creating..." : "Create Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
