"use client";

import { FormEvent, useCallback, useState } from "react";
import { Dices, Eye, EyeOff, KeyRound, Plus, UserPlus, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { UserAdmin } from "@/lib/types";
import { generatePassword } from "@/lib/generate-password";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableEmptyRow, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui/data-table";
import { useAsyncData } from "@/hooks/use-async-data";
import { useFormatDateTime } from "@/hooks/use-format-datetime";
import { notify } from "@/lib/toast";

type Props = {
  currentUserId?: string;
};

function PasswordField({
  id,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={8}
        autoComplete="new-password"
        className="pr-10 font-mono text-sm"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-10 w-10 text-zinc-500 hover:text-zinc-200"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={onToggleVisible}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function UsersPanel({ currentUserId }: Props) {
  const { formatDate } = useFormatDateTime();
  const fetchUsers = useCallback(() => apiFetch<UserAdmin[]>("/users"), []);
  const { data: users, loading, error, refetch } = useAsyncData(fetchUsers);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const list = users ?? [];

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch<UserAdmin>("/users", {
        method: "POST",
        json: {
          email,
          username: username.trim() || null,
          password,
        },
      });
      setEmail("");
      setUsername("");
      setPassword("");
      await refetch();
      notify.success("User created");
    } catch (err) {
      notify.apiError(err, "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(user: UserAdmin) {
    setBusyId(user.id);
    try {
      await apiFetch<UserAdmin>(`/users/${user.id}`, {
        method: "PATCH",
        json: { is_active: !user.is_active },
      });
      await refetch();
      notify.success(user.is_active ? "User deactivated" : "User activated");
    } catch (err) {
      notify.apiError(err, "Could not update user");
    } finally {
      setBusyId(null);
    }
  }

  async function onResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetUserId) return;
    setResetting(true);
    try {
      await apiFetch(`/users/${resetUserId}/password`, {
        method: "POST",
        json: { new_password: resetPassword },
      });
      setResetUserId(null);
      setResetPassword("");
      notify.success("Password reset");
    } catch (err) {
      notify.apiError(err, "Could not reset password");
    } finally {
      setResetting(false);
    }
  }

  const resetUser = resetUserId ? list.find((u) => u.id === resetUserId) : null;

  async function fillGeneratedPassword(setter: (value: string) => void) {
    const pw = generatePassword();
    setter(pw);
    try {
      await navigator.clipboard.writeText(pw);
      notify.success("Password generated and copied");
    } catch {
      notify.success("Password generated");
      notify.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,20rem)_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-emerald-500" />
            Add operator
          </CardTitle>
          <CardDescription>
            Create accounts directly — no need to enable public registration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-3">
            <div>
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="new-user-username">Username (optional)</Label>
              <Input
                id="new-user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="letters, numbers, . _ -"
                autoComplete="off"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label htmlFor="new-user-password">Password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-zinc-500"
                  onClick={() => void fillGeneratedPassword(setPassword)}
                >
                  <Dices className="mr-1 h-3.5 w-3.5" />
                  Generate
                </Button>
              </div>
              <PasswordField
                id="new-user-password"
                value={password}
                onChange={setPassword}
                visible={showCreatePassword}
                onToggleVisible={() => setShowCreatePassword((v) => !v)}
              />
            </div>
            <Button type="submit" disabled={creating} className="w-full">
              {creating ? (
                <>
                  <Spinner size="sm" className="mr-2 border-t-zinc-100" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create user
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-zinc-500" />
              Operators
            </CardTitle>
            <CardDescription>
              {list.length} account{list.length === 1 ? "" : "s"} — activate, deactivate, or reset passwords.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {error ? <p className="px-6 py-4 text-sm text-rose-400">{error}</p> : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
              <Spinner />
              Loading users…
            </div>
          ) : (
            <TableWrap className="rounded-none border-0 bg-transparent">
              <Table>
                <THead>
                  <tr>
                    <Th>User</Th>
                    <Th>Status</Th>
                    <Th>Created</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <TBody>
                  {list.length === 0 ? (
                    <TableEmptyRow colSpan={4}>No users yet</TableEmptyRow>
                  ) : (
                    list.map((u) => {
                      const isSelf = u.id === currentUserId;
                      return (
                        <Tr key={u.id}>
                          <Td>
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-200 truncate">
                                {u.username ?? u.email.split("@")[0]}
                                {isSelf ? (
                                  <span className="ml-2 text-[10px] font-normal text-zinc-500">(you)</span>
                                ) : null}
                              </p>
                              <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                            </div>
                          </Td>
                          <Td>
                            <Badge tone={u.is_active ? "success" : "default"}>
                              {u.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </Td>
                          <Td mono className="whitespace-nowrap text-zinc-500">
                            {formatDate(u.created_at)}
                          </Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                disabled={busyId === u.id}
                                onClick={() => {
                                  setResetUserId(u.id);
                                  setResetPassword("");
                                  setShowResetPassword(false);
                                }}
                              >
                                <KeyRound className="mr-1 h-3.5 w-3.5" />
                                Reset
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                disabled={isSelf || busyId === u.id}
                                title={isSelf ? "Cannot deactivate your own account" : undefined}
                                onClick={() => void toggleActive(u)}
                              >
                                {busyId === u.id ? (
                                  <Spinner size="sm" />
                                ) : u.is_active ? (
                                  "Deactivate"
                                ) : (
                                  "Activate"
                                )}
                              </Button>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {resetUser ? (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm xl:col-span-2">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100">Reset password</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Set a new password for <span className="text-zinc-300">{resetUser.email}</span>.
            </p>
            <form onSubmit={onResetPassword} className="mt-4 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label htmlFor="reset-pw">New password</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-zinc-500"
                    onClick={() => void fillGeneratedPassword(setResetPassword)}
                  >
                    <Dices className="mr-1 h-3.5 w-3.5" />
                    Generate
                  </Button>
                </div>
                <PasswordField
                  id="reset-pw"
                  value={resetPassword}
                  onChange={setResetPassword}
                  visible={showResetPassword}
                  onToggleVisible={() => setShowResetPassword((v) => !v)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setResetUserId(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={resetting}>
                  {resetting ? <Spinner size="sm" className="mr-1" /> : null}
                  Save password
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
