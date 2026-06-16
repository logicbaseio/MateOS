import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, User, Building2, Mail, Phone, TrendingUp, Calendar,
  Plus, X, FileText, DollarSign, Clock, MessageSquare, Edit2, Check, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Interaction {
  id: number;
  customerId: number;
  type: string;
  title: string;
  notes: string | null;
  metadata: unknown;
  createdAt: string;
}

interface MeetingRequest {
  id: number;
  purpose: string;
  status: string;
  preferredDate: string;
  requesterName: string;
  urgency: string;
  createdAt: string;
}

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
  createdAt: string;
  interactions: Interaction[];
  meetingRequests: MeetingRequest[];
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
      "px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded border",
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

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function InteractionIcon({ type }: { type: string }) {
  switch (type) {
    case "meeting_request": return <Calendar size={14} className="text-blue-400" />;
    case "revenue": return <DollarSign size={14} className="text-emerald-400" />;
    case "note": return <FileText size={14} className="text-muted-foreground" />;
    case "meeting_booked": return <Check size={14} className="text-green-400" />;
    default: return <MessageSquare size={14} className="text-muted-foreground" />;
  }
}

function MeetingStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "border-yellow-500/50 text-yellow-400",
    approved: "border-green-500/50 text-green-400",
    declined: "border-red-500/50 text-red-400",
    scheduled: "border-blue-500/50 text-blue-400",
  };
  return (
    <span className={cn("px-2 py-0.5 text-xs font-semibold uppercase rounded border", colors[status] ?? "border-border text-muted-foreground")}>
      {status}
    </span>
  );
}

interface CustomerDetailProps {
  params: { id: string };
}

export default function CustomerDetail({ params }: CustomerDetailProps) {
  const customerId = parseInt(params.id, 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [revenueForm, setRevenueForm] = useState({ amount: "", description: "" });
  const [noteForm, setNoteForm] = useState({ title: "", notes: "" });

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Customer not found");
      return res.json() as Promise<Customer>;
    },
    enabled: !isNaN(customerId),
  });

  const updateCustomer = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      setEditField(null);
      toast({ title: "Updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addRevenue = useMutation({
    mutationFn: async (data: { amount: string; description: string }) => {
      const res = await fetch(`/api/customers/${customerId}/revenue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(data.amount), description: data.description }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to add revenue");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      setShowRevenueModal(false);
      setRevenueForm({ amount: "", description: "" });
      toast({ title: "Revenue added" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addNote = useMutation({
    mutationFn: async (data: { title: string; notes: string }) => {
      const res = await fetch(`/api/customers/${customerId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", title: data.title, notes: data.notes }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      setShowNoteModal(false);
      setNoteForm({ title: "", notes: "" });
      toast({ title: "Note added" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (field: string, currentValue: string) => {
    setEditField(field);
    setEditValue(currentValue);
  };

  const saveEdit = () => {
    if (!editField) return;
    updateCustomer.mutate({ [editField]: editValue });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="max-w-4xl mx-auto pb-12">
        <Link href="/scheduling/customers">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-6">
            <ArrowLeft size={15} /> Back to Customers
          </span>
        </Link>
        <div className="text-center py-16 text-muted-foreground">Customer not found.</div>
      </div>
    );
  }

  // De-duplicate: interactions already contain meeting_request entries logged by the engine.
  // Only include a meetingRequest from the meetingRequests array if there is no corresponding
  // meeting_request or meeting_booked interaction that references it.
  const coveredByInteraction = new Set(
    customer.interactions
      .filter(i => i.type === "meeting_request" || i.type === "meeting_booked")
      .map(i => {
        const meta = i.metadata as Record<string, unknown> | null;
        return meta?.meetingRequestId as number | undefined;
      })
      .filter(Boolean)
  );
  const uncoveredMeetings = customer.meetingRequests.filter(r => !coveredByInteraction.has(r.id));

  const allTimeline = [
    ...customer.interactions.map(i => ({ ...i, _kind: "interaction" as const })),
    ...uncoveredMeetings.map(r => ({
      id: r.id,
      customerId: customer.id,
      type: "meeting_request_entry",
      title: `Meeting: ${r.purpose}`,
      notes: `Status: ${r.status} | Urgency: ${r.urgency}`,
      metadata: { meetingRequestId: r.id, status: r.status },
      createdAt: r.createdAt,
      _kind: "meeting" as const,
      meetingRequest: r,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <Link href="/scheduling/customers">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-6">
          <ArrowLeft size={15} /> Back to Customers
        </span>
      </Link>

      {/* Profile Header */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User size={24} className="text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              {editField === "name" ? (
                <div className="flex items-center gap-2">
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="text-xl font-bold bg-background border border-border rounded-lg px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <button onClick={saveEdit} className="text-primary hover:text-primary/80">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditField(null)} className="text-muted-foreground hover:text-foreground">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  {customer.name}
                  <button onClick={() => startEdit("name", customer.name)} className="text-muted-foreground hover:text-foreground transition-colors opacity-0 hover:opacity-100 group-hover:opacity-100">
                    <Edit2 size={14} />
                  </button>
                </h1>
              )}
              <TierBadge tier={customer.tier} />
              {editField === "tier" ? (
                <div className="flex items-center gap-2">
                  <select
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="text-sm bg-background border border-border rounded-lg px-2 py-0.5 text-foreground focus:outline-none"
                  >
                    <option value="new">New</option>
                    <option value="regular">Regular</option>
                    <option value="vip">VIP</option>
                    <option value="premium">Premium</option>
                  </select>
                  <button onClick={saveEdit} className="text-primary hover:text-primary/80"><Check size={16} /></button>
                  <button onClick={() => setEditField(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => startEdit("tier", customer.tier)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <Edit2 size={11} /> Change tier
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5">
                <Mail size={13} />
                {editField === "email" ? (
                  <span className="flex items-center gap-1">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} className="text-sm bg-background border border-border rounded px-1 text-foreground focus:outline-none" autoFocus />
                    <button onClick={saveEdit} className="text-primary"><Check size={13} /></button>
                    <button onClick={() => setEditField(null)} className="text-muted-foreground"><X size={13} /></button>
                  </span>
                ) : (
                  <span onClick={() => startEdit("email", customer.email)} className="cursor-pointer hover:text-foreground transition-colors">{customer.email}</span>
                )}
              </span>
              {customer.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone size={13} />
                  {editField === "phone" ? (
                    <span className="flex items-center gap-1">
                      <input value={editValue} onChange={e => setEditValue(e.target.value)} className="text-sm bg-background border border-border rounded px-1 text-foreground focus:outline-none" autoFocus />
                      <button onClick={saveEdit} className="text-primary"><Check size={13} /></button>
                      <button onClick={() => setEditField(null)} className="text-muted-foreground"><X size={13} /></button>
                    </span>
                  ) : (
                    <span onClick={() => startEdit("phone", customer.phone ?? "")} className="cursor-pointer hover:text-foreground transition-colors">{customer.phone}</span>
                  )}
                </span>
              )}
              {customer.company && (
                <span className="flex items-center gap-1.5">
                  <Building2 size={13} />
                  {editField === "company" ? (
                    <span className="flex items-center gap-1">
                      <input value={editValue} onChange={e => setEditValue(e.target.value)} className="text-sm bg-background border border-border rounded px-1 text-foreground focus:outline-none" autoFocus />
                      <button onClick={saveEdit} className="text-primary"><Check size={13} /></button>
                      <button onClick={() => setEditField(null)} className="text-muted-foreground"><X size={13} /></button>
                    </span>
                  ) : (
                    <span onClick={() => startEdit("company", customer.company ?? "")} className="cursor-pointer hover:text-foreground transition-colors">{customer.company}</span>
                  )}
                </span>
              )}
              {!customer.phone && (
                <button onClick={() => { setEditField("phone"); setEditValue(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <Plus size={11} /> Add phone
                </button>
              )}
              {!customer.company && (
                <button onClick={() => { setEditField("company"); setEditValue(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <Plus size={11} /> Add company
                </button>
              )}
            </div>

            {editField === "notes" ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={2}
                  className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"><Check size={12} /> Save</button>
                  <button onClick={() => setEditField(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><X size={12} /> Cancel</button>
                </div>
              </div>
            ) : (
              <p
                onClick={() => startEdit("notes", customer.notes ?? "")}
                className="mt-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors italic"
              >
                {customer.notes ? customer.notes : "Click to add notes..."}
              </p>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-5 border-t border-border">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{formatRevenue(customer.totalRevenue, customer.currency)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Lifetime Revenue</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{customer.meetingRequests.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Meetings</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-foreground">{formatDate(customer.firstContactAt)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">First Contact</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-foreground">{formatDate(customer.lastContactAt)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Last Contact</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => setShowRevenueModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm font-semibold hover:bg-emerald-500/20 transition-colors"
          >
            <TrendingUp size={15} /> Add Revenue
          </button>
          <button
            onClick={() => setShowNoteModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground border border-border rounded-xl text-sm font-semibold hover:text-foreground transition-colors"
          >
            <Plus size={15} /> Add Note
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-4">Interaction Timeline</h2>
        {allTimeline.length === 0 ? (
          <div className="text-center py-12 bg-card border border-dashed rounded-2xl">
            <Clock size={32} className="mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">No interactions yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allTimeline.map((item) => (
              <div key={`${item._kind}-${item.id}`} className="bg-card border border-border rounded-xl p-4 flex gap-4">
                <div className="mt-0.5 shrink-0">
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                    <InteractionIcon type={item.type} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground text-sm">{item.title}</p>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item._kind === "meeting" && item.meetingRequest && (
                        <>
                          <MeetingStatusBadge status={item.meetingRequest.status} />
                          <Link href={`/scheduling/requests?id=${item.meetingRequest.id}`}>
                            <span className="text-xs text-primary hover:underline cursor-pointer">View</span>
                          </Link>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(item.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Revenue Modal */}
      {showRevenueModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Add Revenue</h2>
              <button onClick={() => setShowRevenueModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Amount ({customer.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={revenueForm.amount}
                  onChange={e => setRevenueForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Description</label>
                <input
                  type="text"
                  value={revenueForm.description}
                  onChange={e => setRevenueForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Consulting fee, Q1 project..."
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 pt-0">
              <button
                onClick={() => setShowRevenueModal(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => addRevenue.mutate(revenueForm)}
                disabled={addRevenue.isPending || !revenueForm.amount}
                className="px-5 py-2 text-sm font-semibold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                {addRevenue.isPending ? "Adding..." : "Add Revenue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Add Note</h2>
              <button onClick={() => setShowNoteModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Title</label>
                <input
                  type="text"
                  value={noteForm.title}
                  onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Note title..."
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Details</label>
                <textarea
                  value={noteForm.notes}
                  onChange={e => setNoteForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional details..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 pt-0">
              <button
                onClick={() => setShowNoteModal(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => addNote.mutate(noteForm)}
                disabled={addNote.isPending || !noteForm.title}
                className="px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {addNote.isPending ? "Saving..." : "Add Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
