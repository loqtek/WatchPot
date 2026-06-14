"use client";

import { FormEvent, useEffect, useState } from "react";
import { Clock, Shield } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/format-datetime";
import { notify } from "@/lib/toast";

export function AccountPanel() {
  const { user, loading: userLoading, refetch: refetchUser } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const [timezone, setTimezone] = useState("America/New_York");
  const [tzSubmitting, setTzSubmitting] = useState(false);

  useEffect(() => {
    if (user?.timezone) setTimezone(user.timezone);
  }, [user?.timezone]);

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      notify.error("New passwords do not match");
      return;
    }
    setPwSubmitting(true);
    try {
      await apiFetch("/auth/password", {
        method: "POST",
        json: { current_password: currentPassword, new_password: newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify.success("Password updated");
      void refetchUser();
    } catch (err) {
      notify.apiError(err, "Could not update password");
    } finally {
      setPwSubmitting(false);
    }
  }

  async function onTimezone(e: FormEvent) {
    e.preventDefault();
    setTzSubmitting(true);
    try {
      await apiFetch("/auth/me", {
        method: "PATCH",
        json: { timezone },
      });
      notify.success("Timezone updated");
      void refetchUser();
    } catch (err) {
      notify.apiError(err, "Could not update timezone");
    } finally {
      setTzSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-zinc-500" />
            Your account
          </CardTitle>
          <CardDescription>Signed-in operator profile.</CardDescription>
        </CardHeader>
        <CardContent>
          {userLoading ? (
            <div className="flex items-center gap-2 text-zinc-500">
              <Spinner size="sm" />
              Loading…
            </div>
          ) : user ? (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Email</dt>
                <dd className="font-mono text-zinc-200 text-right break-all">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Username</dt>
                <dd className="text-zinc-200 text-right">{user.username ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Timezone</dt>
                <dd className="text-zinc-200 text-right">{timezoneLabel(user.timezone)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">User ID</dt>
                <dd className="font-mono text-xs text-zinc-400 truncate max-w-[55%]">{user.id}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-500">Could not load profile.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-zinc-500" />
            Display timezone
          </CardTitle>
          <CardDescription>
            Timestamps are stored in UTC. Choose how dates and times appear across the UI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onTimezone} className="space-y-3">
            <div>
              <Label htmlFor="account-tz">Timezone</Label>
              <select
                id="account-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-100"
              >
                {COMMON_TIMEZONES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-600">
                Default is Eastern (America/New_York). Monitoring chart buckets stay in UTC.
              </p>
            </div>
            <Button type="submit" disabled={tzSubmitting || userLoading} size="sm">
              {tzSubmitting ? (
                <>
                  <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                  Saving…
                </>
              ) : (
                "Save timezone"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>Update your own password. You stay signed in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onPassword} className="grid gap-3 sm:max-w-md">
            <div>
              <Label htmlFor="cur-pw">Current password</Label>
              <Input
                id="cur-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
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
              <Label htmlFor="cf-pw">Confirm new password</Label>
              <Input
                id="cf-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={pwSubmitting} size="sm" className="w-fit">
              {pwSubmitting ? (
                <>
                  <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                  Updating…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
