"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api";
import { notify } from "@/lib/toast";
import { AuthPageLayout } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        access_token: string;
        local_agent?: { pot_id: string; created: boolean; credentials_written: boolean } | null;
      }>("/auth/login", {
        method: "POST",
        json: { identifier, password },
      });
      setToken(res.access_token);
      if (res.local_agent?.credentials_written) {
        sessionStorage.setItem(
          "watchpot_local_agent_notice",
          res.local_agent.created
            ? "Local agent registered — the dev agent should connect shortly."
            : "Local agent credentials refreshed — the dev agent should reconnect shortly.",
        );
      }
      router.push("/dashboard");
    } catch (e) {
      notify.apiError(e, "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Sign in"
      subtitle="Use your username or email and password. Default admin credentials are printed once in API logs on first bootstrap."
      footer={
        <p>
          Need an account?{" "}
          <Link href="/register" className="text-emerald-500 hover:text-emerald-400 font-medium">
            Register
          </Link>{" "}
          <span className="text-zinc-600">(if enabled by your admin)</span>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="login-identifier">Username or email</Label>
          <Input
            id="login-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size="sm" className="mr-2 border-t-zinc-100" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
