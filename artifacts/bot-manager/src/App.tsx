import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import { useAuth } from "@/hooks/useAuth";

import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Preferences from "@/pages/Preferences";
import MeetingRequests from "@/pages/MeetingRequests";
import AmazonAlerts from "@/pages/AmazonAlerts";
import TeamChannels from "@/pages/TeamChannels";
import EmailSimulator from "@/pages/EmailSimulator";
import Chat from "@/pages/Chat";
import Soul from "@/pages/Soul";
import Brain from "@/pages/Brain";
import Channels from "@/pages/Channels";
import Approvals from "@/pages/Approvals";
import Integrations from "@/pages/Integrations";
import BotSettings from "@/pages/BotSettings";
import BossMemory from "@/pages/BossMemory";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <AuthGuard>
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        
        {/* Scheduler Bot Routes */}
        <Route path="/scheduling/preferences" component={Preferences} />
        <Route path="/scheduling/requests" component={MeetingRequests} />
        <Route path="/scheduling/chat" component={Chat} />
        <Route path="/scheduling/soul" component={Soul} />
        <Route path="/brain" component={Brain} />
        <Route path="/channels" component={Channels} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/scheduling/bot-settings" component={BotSettings} />
        <Route path="/scheduling/memory" component={BossMemory} />
        <Route path="/scheduling/customers" component={Customers} />
        <Route path="/scheduling/customers/:id" component={CustomerDetail} />
        
        {/* Amazon Bot Routes */}
        <Route path="/amazon/alerts" component={AmazonAlerts} />
        <Route path="/amazon/channels" component={TeamChannels} />
        <Route path="/amazon/simulator" component={EmailSimulator} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
    </AuthGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
