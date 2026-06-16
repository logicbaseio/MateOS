import { useConversations } from "@/hooks/use-conversations";
import { formatDate } from "@/lib/utils";
import { Bot, User } from "lucide-react";

export default function Conversations() {
  const { data: convos, isLoading } = useConversations();

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">Bot Conversations</h1>
        <p className="text-muted-foreground mt-1">Logs of AI interactions with team members.</p>
      </div>

      <div className="space-y-6">
        {convos?.map(convo => (
          <div key={convo.id} className="bg-card rounded-3xl p-6 border shadow-lg shadow-black/5">
            <div className="flex items-center justify-between mb-4 border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-xl">
                  {convo.botType === "scheduler" ? <Bot className="text-primary" /> : <Bot className="text-accent" />}
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Session with {convo.participant}</h3>
                  <p className="text-xs text-muted-foreground capitalize">{convo.botType} Bot • {formatDate(convo.createdAt)}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-muted/30 rounded-2xl mb-4">
              <h4 className="text-sm font-bold uppercase text-muted-foreground mb-2">AI Summary</h4>
              <p className="text-foreground font-medium">{convo.summary}</p>
            </div>

            <div className="space-y-4 px-2">
              {/* Parse stringified JSON messages if they were stored that way, otherwise just display text */}
              <div className="text-sm font-mono text-muted-foreground whitespace-pre-wrap bg-card border rounded-xl p-4 overflow-x-auto">
                {convo.messages}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
