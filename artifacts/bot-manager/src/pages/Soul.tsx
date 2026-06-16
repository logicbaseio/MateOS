import { useState, useEffect } from "react";
import { useGetSoul, useUpdateSoul } from "@workspace/api-client-react";
import { Save, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBotName } from "@/hooks/use-preferences";

export default function Soul() {
  const botName = useBotName();
  const { data, isLoading } = useGetSoul();
  const { mutate: saveSoul, isPending } = useUpdateSoul();
  const { toast } = useToast();

  const [content, setContent] = useState("");

  useEffect(() => {
    if (data?.content !== undefined) {
      setContent(data.content);
    }
  }, [data]);

  const handleSave = () => {
    saveSoul(
      { data: { content } },
      {
        onSuccess: () => {
          toast({
            title: "Soul saved",
            description: `${botName} will use the updated personality on her next response.`,
          });
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Unknown error";
          toast({
            title: "Save failed",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Loader2 className="animate-spin inline mr-2" />
        Loading soul...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-2">
            <Sparkles className="text-primary" size={28} />
            Assistant Soul
          </h1>
          <p className="text-muted-foreground mt-1">
            Edit {botName}'s personality, memory, and behavior rules. Changes take effect on the next message.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
        >
          {isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {isPending ? "Saving…" : "Save Soul"}
        </button>
      </div>

      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/40 flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">soul.md</span>
          <span className="ml-auto text-xs text-muted-foreground">{content.length} characters</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full min-h-[60vh] p-6 font-mono text-sm bg-card text-foreground resize-y focus:outline-none leading-relaxed"
          placeholder={`Write ${botName}'s personality, rules, and memory here in plain text or markdown...`}
          spellCheck={false}
        />
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-center">
        This file is prepended to every AI prompt. Keep it clear and focused for best results.
      </p>
    </div>
  );
}
