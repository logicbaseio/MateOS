import { useState } from "react";
import { useMeetingRequests, useUpdateMeeting, useSuggestTime } from "@/hooks/use-meetings";
import { formatDate, cn } from "@/lib/utils";
import { Clock, Check, X, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MeetingRequest } from "@workspace/api-client-react";

export default function MeetingRequests() {
  const { data: requests, isLoading } = useMeetingRequests();
  const { mutate: updateReq, isPending: isUpdating } = useUpdateMeeting();
  const { mutate: suggest, isPending: isSuggesting } = useSuggestTime();
  const { toast } = useToast();

  const [activeReqId, setActiveReqId] = useState<number | null>(null);

  const handleAction = (id: number, status: "approved" | "declined") => {
    updateReq({ id, data: { status } }, {
      onSuccess: () => toast({ title: `Request ${status}` }),
      onError: () => toast({ title: "Action failed", variant: "destructive" })
    });
  };

  const handleSuggest = (id: number) => {
    setActiveReqId(id);
    suggest(id, {
      onSuccess: () => toast({ title: "AI Suggested new times" }),
      onError: () => toast({ title: "Suggestion failed", variant: "destructive" }),
      onSettled: () => setActiveReqId(null)
    });
  };

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Meeting Inbox</h1>
        <p className="text-muted-foreground mt-1">Review team requests. AI suggestions available.</p>
      </div>

      <div className="grid gap-6">
        {requests?.length === 0 && (
          <div className="text-center py-16 bg-card border border-dashed rounded-3xl">
            <p className="text-muted-foreground font-medium">No meeting requests found.</p>
          </div>
        )}

        {requests?.map(req => (
          <div key={req.id} className="bg-card rounded-3xl p-6 border shadow-lg shadow-black/5 hover:shadow-xl transition-all">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-bold font-display">{req.purpose}</h3>
                  <UrgencyBadge urgency={req.urgency} />
                  <StatusBadge status={req.status} />
                </div>
                
                <div className="flex items-center gap-2 text-muted-foreground mb-4">
                  <span className="font-semibold text-foreground">{req.requesterName}</span>
                  <span>•</span>
                  <span>{req.requesterEmail}</span>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <Clock size={14} />
                    Requested: {formatDate(req.preferredDate)}
                  </div>
                </div>

                {req.botSuggestion && (
                  <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-xl relative">
                    <Sparkles className="absolute top-4 right-4 text-primary opacity-20" size={40} />
                    <p className="text-sm font-semibold text-primary mb-1">AI Recommendation</p>
                    <p className="text-foreground">{req.botSuggestion}</p>
                  </div>
                )}
              </div>

              {req.status === "pending" && (
                <div className="flex flex-row md:flex-col justify-end gap-3 shrink-0 md:min-w-[160px]">
                  <button 
                    onClick={() => handleSuggest(req.id)}
                    disabled={isSuggesting}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary to-accent text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/30 transition-all disabled:opacity-50"
                  >
                    {isSuggesting && activeReqId === req.id ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Ask AI
                  </button>
                  <button 
                    onClick={() => handleAction(req.id, "approved")}
                    disabled={isUpdating}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-success text-success-foreground font-semibold rounded-xl hover:bg-success/90 transition-all disabled:opacity-50"
                  >
                    <Check size={16} /> Approve
                  </button>
                  <button 
                    onClick={() => handleAction(req.id, "declined")}
                    disabled={isUpdating}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 text-destructive font-semibold rounded-xl hover:bg-destructive hover:text-white transition-all disabled:opacity-50"
                  >
                    <X size={16} /> Decline
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const colors: Record<string, string> = {
    critical: "bg-destructive text-white",
    high: "bg-warning text-white",
    medium: "bg-primary/20 text-primary",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded-md", colors[urgency] || colors.low)}>
      {urgency}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "border-warning text-warning",
    approved: "border-success text-success",
    declined: "border-destructive text-destructive",
    scheduled: "border-primary text-primary",
  };
  return (
    <span className={cn("px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded-md border", colors[status] || "border-muted")}>
      {status}
    </span>
  );
}
