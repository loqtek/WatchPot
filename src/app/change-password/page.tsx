"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getApiBase, rememberCsrfToken } from "@/lib/api";
import { notify } from "@/lib/toast";
import { AuthPageLayout } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { UserOut } from "@/lib/types";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${getApiBase().replace(/\/$/, "")}/auth/me`, { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const user = (await res.json()) as UserOut;
        if (!user.must_change_password) {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      notify.error("New passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ csrf_token?: string | null }>("/auth/password", {
        method: "POST",
        json: { current_password: currentPassword, new_password: newPassword },
      });
      if (res?.csrf_token) rememberCsrfToken(res.csrf_token);
      notify.success("Password updated");
      router.replace("/dashboard");
    } catch (err) {
      notify.apiError(err, "Could not update password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Choose a new password"
      subtitle="The temporary password from the server logs only works until you replace it. After this step it cannot be used again."
    >
      {ready ? (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <Label htmlFor="temp-pw">Temporary password</Label>
            <Input
              id="temp-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="new-pw">New password</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label htmlFor="confirm-pw">Confirm new password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner size="sm" className="mr-2 border-white/30 border-t-white" />
                Saving…
              </>
            ) : (
              "Save password and continue"
            )}
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-center gap-2 py-6 text-zinc-500">
          <Spinner size="sm" />
          Checking session…
        </div>
      )}
    </AuthPageLayout>
  );
}
