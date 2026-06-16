import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: "Authentication failed. Please try again.",
  no_code: "Sign-in was cancelled or failed. Please try again.",
};

export default function Login() {
  const error = new URLSearchParams(window.location.search).get("error");

  function handleSignIn() {
    window.location.href = "/api/login";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full">
        <div className="flex items-center gap-3">
          <Bot className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">MateOS</h1>
        </div>
        <p className="text-muted-foreground text-center text-sm">
          Sign in to access your MateOS operations dashboard.
        </p>
        {error && (
          <p className="text-destructive text-center text-sm">
            {ERROR_MESSAGES[error] ?? "An error occurred. Please try again."}
          </p>
        )}
        <Button onClick={handleSignIn} className="w-full" size="lg">
          <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="10" height="10" fill="#F25022" />
            <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
            <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
            <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
          </svg>
          Sign in
        </Button>
      </div>
    </div>
  );
}
