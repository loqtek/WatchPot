"use client";

import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { apiFetch, rememberCsrfToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";
import { notify } from "@/lib/toast";

type SetupOut = {
  secret: string;
  otpauth_uri: string;
  qr_svg: string;
};

export function TotpCard() {
  const { user, refetch } = useAuth();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<SetupOut | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<SetupOut>("/auth/totp/setup", {
        method: "POST",
        json: { current_password: password },
      });
      setSetup(res);
      setRecovery(null);
      notify.success("Scan the code, then enter the 6-digit number to confirm");
    } catch (err) {
      notify.apiError(err, "Could not start authenticator setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ recovery_codes: string[] }>("/auth/totp/confirm", {
        method: "POST",
        json: { code },
      });
      setRecovery(res.recovery_codes);
      setSetup(null);
      setCode("");
      setPassword("");
      notify.success("Authenticator enabled");
      void refetch();
    } catch (err) {
      notify.apiError(err, "That code was not accepted");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ csrf_token?: string | null }>("/auth/totp/disable", {
        method: "POST",
        json: { current_password: password, code },
      });
      if (res?.csrf_token) rememberCsrfToken(res.csrf_token);
      setPassword("");
      setCode("");
      notify.success("Authenticator disabled. Other sessions were signed out.");
      void refetch();
    } catch (err) {
      notify.apiError(err, "Could not disable authenticator");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-zinc-500" />
          Authenticator
        </CardTitle>
        <CardDescription>
          Optional second step at sign-in. Use any TOTP app. Recovery codes are shown once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {user?.totp_enabled ? (
          <form onSubmit={disable} className="grid gap-3 sm:max-w-md">
            <p className="text-sm text-zinc-400">Authenticator is on for this account.</p>
            <div>
              <Label htmlFor="totp-off-pw">Current password</Label>
              <Input
                id="totp-off-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label htmlFor="totp-off-code">Code or recovery code</Label>
              <Input
                id="totp-off-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoComplete="one-time-code"
                className="font-mono"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={busy} className="w-fit">
              {busy ? <Spinner size="sm" className="mr-2 border-t-zinc-100" /> : null}
              Turn off authenticator
            </Button>
          </form>
        ) : setup ? (
          <form onSubmit={confirmSetup} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <img
              alt="Authenticator QR code"
              className="h-40 w-40 rounded-md bg-white p-2"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qr_svg)}`}
            />
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Scan the code, or enter this secret manually:
              </p>
              <p className="break-all font-mono text-xs text-zinc-200">{setup.secret}</p>
              <div>
                <Label htmlFor="totp-confirm">6-digit code</Label>
                <Input
                  id="totp-confirm"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="mt-1 max-w-[10rem] font-mono"
                />
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Spinner size="sm" className="mr-2 border-t-zinc-100" /> : null}
                Confirm authenticator
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={startSetup} className="grid gap-3 sm:max-w-md">
            <div>
              <Label htmlFor="totp-pw">Current password</Label>
              <Input
                id="totp-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" size="sm" disabled={busy} className="w-fit">
              {busy ? <Spinner size="sm" className="mr-2 border-t-zinc-100" /> : null}
              Set up authenticator
            </Button>
          </form>
        )}
        {recovery ? (
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3">
            <p className="text-sm text-amber-200">
              Save these recovery codes. Each one works once if you lose the authenticator.
            </p>
            <ul className="mt-2 grid gap-1 font-mono text-sm text-zinc-100 sm:grid-cols-2">
              {recovery.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
