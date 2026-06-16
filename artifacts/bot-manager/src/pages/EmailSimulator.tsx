import { useState } from "react";
import { useSimulateEmail } from "@/hooks/use-alerts";
import { Mail, Loader2, Send, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { IncomingEmailBody, EmailProcessingResult } from "@workspace/api-client-react";

export default function EmailSimulator() {
  const { mutate: simulate, isPending } = useSimulateEmail();
  const { toast } = useToast();
  const [result, setResult] = useState<EmailProcessingResult | null>(null);

  const [formData, setFormData] = useState<IncomingEmailBody>({
    subject: "ALARM: High CPU Utilization on EU-Prod-Web",
    body: "AWS Notification: CPU utilization exceeded 90% for 5 minutes.\nAccount ID: 123456789012",
    senderEmail: "no-reply-aws@amazon.com",
    receivedAt: new Date().toISOString(),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    simulate(formData, {
      onSuccess: (data) => {
        setResult(data);
        toast({ title: "Email processed", description: data.message });
      },
      onError: () => toast({ title: "Processing failed", variant: "destructive" })
    });
  };

  return (
    <div className="max-w-4xl mx-auto pb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground">Email Simulator</h1>
          <p className="text-muted-foreground mt-1">Test the Amazon alert router logic.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card p-6 md:p-8 rounded-3xl border shadow-lg space-y-5">
          <div>
            <label className="text-sm font-medium mb-1 block">Sender Email</label>
            <input 
              required 
              value={formData.senderEmail} 
              onChange={e => setFormData({...formData, senderEmail: e.target.value})} 
              className="w-full px-4 py-3 bg-background border-2 rounded-xl focus:border-primary outline-none" 
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Subject</label>
            <input 
              required 
              value={formData.subject} 
              onChange={e => setFormData({...formData, subject: e.target.value})} 
              className="w-full px-4 py-3 bg-background border-2 rounded-xl focus:border-primary outline-none" 
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Email Body (Must contain Account ID)</label>
            <textarea 
              required 
              rows={6}
              value={formData.body} 
              onChange={e => setFormData({...formData, body: e.target.value})} 
              className="w-full px-4 py-3 bg-background border-2 rounded-xl focus:border-primary outline-none resize-none" 
            />
          </div>
          <button 
            type="submit" 
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-primary to-accent text-white font-bold rounded-xl hover:shadow-lg transition-all disabled:opacity-50"
          >
            {isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            Process Email via Webhook
          </button>
        </form>
      </div>

      <div className="pt-2 md:pt-24">
        {result ? (
          <div className="bg-card p-8 rounded-3xl border-2 border-success/30 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-success/10 blur-3xl rounded-full" />
            <div className="flex items-center gap-3 text-success mb-6">
              <CheckCircle2 size={32} />
              <h3 className="text-2xl font-bold font-display">Processing Result</h3>
            </div>
            
            <div className="space-y-4">
              <ResultRow label="Status" value={result.message} />
              <ResultRow label="Account Found" value={result.amazonAccountId} />
              <ResultRow label="Alert Priority" value={result.priority} highlight />
              <ResultRow label="Routed To" value={result.routedTo || "No mapping found"} />
              <ResultRow label="Alert ID Created" value={result.alertId?.toString() || "None"} />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-muted/30 border-2 border-dashed rounded-3xl">
            <Mail size={48} className="text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-bold text-muted-foreground">Waiting for payload</h3>
            <p className="text-sm text-muted-foreground/70 mt-2">Submit the form to see how the bot router processes the email.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn("text-lg font-medium", highlight ? "text-primary font-bold" : "text-foreground")}>{value}</span>
    </div>
  );
}
