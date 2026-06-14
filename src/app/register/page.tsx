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

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        json: { email, username, password },
      });
      const u = username.trim();
      const loginId = u || email;
      const res = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        json: { identifier: loginId, password },
      });
      setToken(res.access_token);
      router.push("/dashboard");
    } catch (e) {
      notify.apiError(e, "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Create account"
      subtitle="Public registration may be disabled on your server. If signup fails, contact your administrator."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-500 hover:text-emerald-400 font-medium">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="reg-email">Email</Label>
          <Input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="reg-user">Username</Label>
          <Input
            id="reg-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div>
          <Label htmlFor="reg-pass">Password</Label>
          <Input
            id="reg-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
          />
          <p className="mt-1.5 text-xs text-zinc-600">At least 8 characters.</p>
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size="sm" className="mr-2 border-t-zinc-100" />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
