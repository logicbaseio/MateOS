import { useAmazonAlerts, useUpdateAlert } from "@/hooks/use-alerts";
import { formatDate, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, Navigation, XCircle } from "lucide-react";

export default function AmazonAlerts() {
  const { data: alerts, isLoading } = useAmazonAlerts();
  const { mutate: updateAlert, isPending } = useUpdateAlert();
  const { toast } = useToast();

  const handleStatusChange = (id: number, status: any) => {
    updateAlert({ id, data: { status } }, {
      onSuccess: () => toast({ title: "Status updated" }),
      onError: () => toast({ title: "Update failed", variant: "destructive" })
    });
  };

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Amazon Alerts</h1>
        <p className="text-muted-foreground mt-1">Incoming monitoring emails routed to Teams.</p>
      </div>

      <div className="bg-card border rounded-3xl overflow-hidden shadow-lg shadow-black/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="uppercase tracking-wider border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-4 font-semibold">Priority</th>
                <th className="p-4 font-semibold">Details</th>
                <th className="p-4 font-semibold">Routing</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {alerts?.map(alert => (
                <tr key={alert.id} className="hover:bg-muted/30 transition-colors group">
                  <td className="p-4 align-top">
                    <PriorityBadge priority={alert.priority} />
                  </td>
                  <td className="p-4 align-top max-w-sm">
                    <div className="font-bold text-foreground truncate">{alert.subject}</div>
                    <div className="text-muted-foreground text-xs mt-1">Acct: {alert.amazonAccountId} • Type: {alert.alertType}</div>
                    <div className="text-muted-foreground text-xs">{formatDate(alert.receivedAt)}</div>
                  </td>
                  <td className="p-4 align-top">
                    {alert.routedToTeam ? (
                      <div className="flex items-center gap-1.5 text-primary font-medium">
                        <Navigation size={14} />
                        {alert.routedToTeam} / {alert.routedToChannel}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">Unrouted</span>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    <span className="font-semibold uppercase tracking-wider text-xs">{alert.status}</span>
                  </td>
                  <td className="p-4 align-top text-right space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {alert.status !== 'resolved' && (
                      <button 
                        onClick={() => handleStatusChange(alert.id, 'resolved')}
                        disabled={isPending}
                        className="p-2 text-success hover:bg-success/10 rounded-lg transition-colors inline-block"
                        title="Mark Resolved"
                      >
                        <CheckCircle size={18} />
                      </button>
                    )}
                    {alert.status !== 'ignored' && (
                      <button 
                        onClick={() => handleStatusChange(alert.id, 'ignored')}
                        disabled={isPending}
                        className="p-2 text-muted-foreground hover:bg-muted rounded-lg transition-colors inline-block"
                        title="Ignore"
                      >
                        <XCircle size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {alerts?.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No alerts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: "bg-destructive text-white",
    high: "bg-warning text-white",
    medium: "bg-primary/20 text-primary",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded-md", colors[priority] || colors.low)}>
      {priority === 'critical' && <AlertTriangle size={12} />}
      {priority}
    </div>
  );
}
