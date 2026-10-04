"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, rememberCsrfToken } from "@/lib/api";
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
  const [code, setCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function finishLogin(res: {
    csrf_token?: string | null;
    must_change_password?: boolean;
    local_agent?: { pot_id: string; created: boolean; credentials_written: boolean } | null;
  }) {
    if (res.csrf_token) rememberCsrfToken(res.csrf_token);
    if (res.local_agent?.credentials_written) {
      sessionStorage.setItem(
        "watchpot_local_agent_notice",
        res.local_agent.created
          ? "Local agent registered — the dev agent should connect shortly."
          : "Local agent credentials refreshed — the dev agent should reconnect shortly.",
      );
    }
    router.push(res.must_change_password ? "/change-password" : "/dashboard");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (needsTotp) {
        const res = await apiFetch<{
          csrf_token?: string | null;
          must_change_password?: boolean;
        }>("/auth/totp/verify", {
          method: "POST",
          json: { code },
        });
        finishLogin(res);
        return;
      }
      const res = await apiFetch<{
        csrf_token?: string | null;
        totp_required?: boolean;
        must_change_password?: boolean;
        local_agent?: { pot_id: string; created: boolean; credentials_written: boolean } | null;
      }>("/auth/login", {
        method: "POST",
        json: { identifier, password },
      });
      if (res.totp_required) {
        setNeedsTotp(true);
        return;
      }
      finishLogin(res);
    } catch (err) {
      notify.apiError(err, needsTotp ? "Invalid authentication code" : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Sign in"
      subtitle={
        needsTotp
          ? "Enter the 6-digit code from your authenticator, or a recovery code."
          : "Use your username or email and password. The first sign-in asks you to replace the temporary password."
      }
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
        {needsTotp ? null : (
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
        )}
        {needsTotp ? null : (
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
        )}
        {needsTotp ? (
          <div>
            <Label htmlFor="login-code">Authentication code</Label>
            <Input
              id="login-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              autoComplete="one-time-code"
              className="font-mono"
            />
          </div>
        ) : null}
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
