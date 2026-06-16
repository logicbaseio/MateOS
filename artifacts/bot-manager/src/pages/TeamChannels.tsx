import { useState } from "react";
import { useTeamChannels, useCreateChannel, useDeleteChannel } from "@/hooks/use-channels";
import { Plus, Trash2, Network, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import type { CreateTeamChannelBody } from "@workspace/api-client-react";

const EMPTY_FORM: CreateTeamChannelBody = {
  teamName: "",
  channelName: "",
  amazonAccountId: "",
  amazonAccountName: "",
  alertTypes: [],
  msTeamId: "",
  msChannelId: "",
};

export default function TeamChannels() {
  const { data: channels, isLoading } = useTeamChannels();
  const { mutate: createChannel, isPending: isCreating } = useCreateChannel();
  const { mutate: deleteChannel } = useDeleteChannel();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<CreateTeamChannelBody>(EMPTY_FORM);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateTeamChannelBody = {
      ...formData,
      msTeamId: formData.msTeamId || null,
      msChannelId: formData.msChannelId || null,
    };
    createChannel(payload, {
      onSuccess: () => {
        toast({ title: "Channel mapped successfully" });
        setIsFormOpen(false);
        setFormData(EMPTY_FORM);
      },
      onError: () => toast({ title: "Failed to create", variant: "destructive" })
    });
  };

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Team Routing</h1>
          <p className="text-muted-foreground mt-1">Map Amazon accounts to Microsoft Teams channels.</p>
        </div>
        <button 
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background font-semibold rounded-xl hover:bg-foreground/90 transition-all"
        >
          <Plus size={18} />
          New Mapping
        </button>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-8 overflow-hidden"
          >
            <div className="bg-card border-2 border-primary/20 rounded-3xl p-6 shadow-xl">
              <h2 className="text-xl font-bold mb-4">Create Mapping</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Amazon Account Name</label>
                    <input required value={formData.amazonAccountName} onChange={e => setFormData({...formData, amazonAccountName: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none" placeholder="e.g. EU Region Prod" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Amazon Account ID</label>
                    <input required value={formData.amazonAccountId} onChange={e => setFormData({...formData, amazonAccountId: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none" placeholder="12-digit AWS ID" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Teams Team Name</label>
                    <input required value={formData.teamName} onChange={e => setFormData({...formData, teamName: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none" placeholder="Cloud Ops" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Teams Channel Name</label>
                    <input required value={formData.channelName} onChange={e => setFormData({...formData, channelName: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none" placeholder="eu-alerts" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      MS Teams Team ID <span className="text-muted-foreground font-normal">(optional — auto-resolved from name if blank)</span>
                    </label>
                    <input value={formData.msTeamId ?? ""} onChange={e => setFormData({...formData, msTeamId: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none font-mono text-sm" placeholder="19:xxxxxxxx..." />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      MS Teams Channel ID <span className="text-muted-foreground font-normal">(optional — auto-resolved from name if blank)</span>
                    </label>
                    <input value={formData.msChannelId ?? ""} onChange={e => setFormData({...formData, msChannelId: e.target.value})} className="w-full px-4 py-2.5 bg-background border rounded-xl focus:border-primary outline-none font-mono text-sm" placeholder="19:xxxxxxxx..." />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setIsFormOpen(false)} className="px-5 py-2.5 font-semibold text-muted-foreground hover:bg-muted rounded-xl transition-all">Cancel</button>
                  <button type="submit" disabled={isCreating} className="px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2">
                    {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Save
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {channels?.map(ch => (
          <div key={ch.id} className="bg-card p-6 rounded-3xl border shadow-md hover:shadow-xl transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <Network size={24} />
              </div>
              <button 
                onClick={() => {
                  if (confirm("Are you sure?")) {
                    deleteChannel(ch.id, { onSuccess: () => toast({title: "Deleted"}) })
                  }
                }}
                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 size={18} />
              </button>
            </div>
            
            <h3 className="font-display font-bold text-xl mb-1">{ch.amazonAccountName}</h3>
            <p className="font-mono text-xs text-muted-foreground mb-4">{ch.amazonAccountId}</p>
            
            <div className="bg-muted/50 p-3 rounded-xl mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Routes To</p>
              <p className="font-medium text-foreground">{ch.teamName} / {ch.channelName}</p>
            </div>

            {(ch.msTeamId || ch.msChannelId) && (
              <div className="bg-muted/30 p-3 rounded-xl">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Graph IDs</p>
                {ch.msTeamId && <p className="font-mono text-xs text-muted-foreground truncate">Team: {ch.msTeamId}</p>}
                {ch.msChannelId && <p className="font-mono text-xs text-muted-foreground truncate">Channel: {ch.msChannelId}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
