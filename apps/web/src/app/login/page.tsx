"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Store, Lock, Mail, Sparkles, ArrowRight, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

// Read at module scope so Next inlines it at build time: this has to agree with
// what the middleware decides on the server, or the button and the gate disagree.
const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Where to land after a successful sign-in.
 *
 * Read from `location` at submit time rather than with `useSearchParams()`.
 * The hook opts the whole page out of static prerendering unless it sits under
 * a Suspense boundary — and it broke the production build outright — but the
 * value is only ever needed inside an event handler, which by definition runs
 * on the client with a real URL. No hook required.
 *
 * Only same-origin paths are honoured. `?next=https://evil.example` would
 * otherwise turn the login page into an open redirect that borrows this app's
 * credibility, and `//evil.example` is protocol-relative, so it needs rejecting
 * too.
 */
function redirectTarget(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@demo.shop");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase environment variables are missing.");
      }

      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        if (signInError.message === "Failed to fetch" || signInError.message.includes("fetch")) {
          setError("Local Supabase Docker container is not running. Click 'Explore Demo Mode' below to view the app without database backend.");
        } else {
          setError(signInError.message);
        }
        setPending(false);
        return;
      }

      router.push(redirectTarget() as any);
      router.refresh();
    } catch (err: any) {
      if (err?.message?.includes("Failed to fetch") || err?.toString()?.includes("Failed to fetch")) {
        setError("Local Supabase Docker container is not running. Click 'Explore Demo Mode' below to test the app with mock data.");
      } else {
        setError(err?.message || "An unexpected error occurred during authentication.");
      }
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-linear-to-b from-primary-bright to-primary text-primary-foreground glow-btn">
            <Store className="size-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient">
            AI POS Retail System
          </h1>
          <p className="text-sm text-muted-foreground">
            Point of sale & inventory intelligence suite
          </p>
        </div>

        {/* Login Card */}
        <Card glow="lg">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold">Terminal Sign In</CardTitle>
              <Badge variant="default" className="text-xs">Demo Ready</Badge>
            </div>
            <CardDescription>
              Sign in with credentials or jump straight into Demo Mode
            </CardDescription>
          </CardHeader>

          <form onSubmit={onSubmit}>
            <CardContent className="space-y-4">
              {/* Error Notice */}
              {error && <Notice tone="warning">{error}</Notice>}

              {/* Only rendered when the deployment actually allows demo mode.
                  Showing it otherwise would be a button that bounces straight
                  back to this page — the middleware ignores the demo flag
                  unless NEXT_PUBLIC_DEMO_MODE is on, so a visitor cannot switch
                  the auth gate off just by asking. The cookie is set server-side
                  with HttpOnly; setting it here from script could not be. */}
              {DEMO_MODE_ENABLED && (
                <div className="space-y-2 rounded-xl border border-primary/25 bg-primary-soft p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
                      <Sparkles className="size-3.5" />
                      No Database Required
                    </span>
                    <Badge variant="outline" className="text-[10px]">Instant Preview</Badge>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      router.push("/?demo=true" as any);
                      router.refresh();
                    }}
                    block="always"
                  >
                    <Play />
                    <span>Enter Demo POS Terminal</span>
                    <ArrowRight />
                  </Button>
                  <p className="text-[11px] text-primary">
                    Sample figures only — nothing you see is a real shop&apos;s takings.
                  </p>
                </div>
              )}

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-border"></div>
                <span className="mx-3 shrink text-[11px] font-semibold uppercase text-muted-foreground">Or sign in with Supabase</span>
                <div className="grow border-t border-border"></div>
              </div>

              {/* Email Input */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    placeholder="owner@demo.shop"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex-col space-y-3 pt-1">
              <Button type="submit" disabled={pending} variant="outline" block="always">
                {pending ? "Connecting..." : "Sign In with Local Supabase"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
