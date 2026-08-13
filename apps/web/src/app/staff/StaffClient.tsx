"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Pencil,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  clearStaffPin,
  saveStaff,
  setStaffActive,
  setStaffPin,
  type StaffRole,
} from "@/app/staff-actions";
import type { ShopLocation } from "@/lib/tenant";

export interface StaffMember {
  id: string;
  name: string | null;
  email: string | null;
  role: StaffRole;
  is_active: boolean;
  login_enabled: boolean;
  has_pin: boolean;
  location_id: string | null;
  created_at: string;
}

const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including staff and shop settings.",
  manager: "Products, stock, transfers and refunds. Not staff or settings.",
  cashier: "Ring up sales and record stock. Cannot change prices or refund.",
};

const ALL_LOCATIONS = "__all__";

export function StaffClient({
  staff,
  locations,
  canEdit,
  currentUserId,
}: {
  staff: StaffMember[];
  locations: ShopLocation[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [pinFor, setPinFor] = useState<StaffMember | null>(null);

  const [form, setForm] = useState({
    name: "",
    role: "cashier" as StaffRole,
    locationId: ALL_LOCATIONS,
    email: "",
  });
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  const owners = staff.filter((s) => s.role === "owner" && s.is_active);
  const activeCount = staff.filter((s) => s.is_active).length;

  function openNew() {
    setIsNew(true);
    setEditing(null);
    setForm({ name: "", role: "cashier", locationId: ALL_LOCATIONS, email: "" });
    setNotice(null);
  }

  function openEdit(member: StaffMember) {
    setIsNew(false);
    setEditing(member);
    setForm({
      name: member.name ?? "",
      role: member.role,
      locationId: member.location_id ?? ALL_LOCATIONS,
      email: member.email ?? "",
    });
    setNotice(null);
  }

  function closeForm() {
    setEditing(null);
    setIsNew(false);
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveStaff({
        id: editing?.id ?? null,
        name: form.name,
        role: form.role,
        locationId: form.locationId === ALL_LOCATIONS ? null : form.locationId,
        email: form.email.trim() || null,
      });
      setNotice(result);
      if (result.ok) {
        closeForm();
        router.refresh();
      }
    });
  }

  function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== pinConfirm) {
      setNotice({ ok: false, message: "The two PINs don't match." });
      return;
    }
    const target = pinFor;
    if (!target) return;

    startTransition(async () => {
      const result = await setStaffPin(target.id, pin);
      setNotice(result);
      if (result.ok) {
        setPinFor(null);
        setPin("");
        setPinConfirm("");
        router.refresh();
      }
    });
  }

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await fn();
      setNotice(result);
      if (result.ok) router.refresh();
    });
  }

  const formOpen = isNew || editing !== null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
            <Users className="h-6 w-6 text-emerald-600" />
            Staff &amp; Permissions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            A cashier doesn&apos;t need an email address — give them a PIN and they can work
            the till on the shop&apos;s device.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add staff member
          </Button>
        )}
      </div>

      {notice && (
        <div
          className={
            notice.ok
              ? "flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          }
        >
          {notice.ok ? (
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      {!canEdit && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Only an owner can add or change staff. You can see who&apos;s on the team.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active staff
            </CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="text-xs text-slate-500 mt-1">
              {staff.length - activeCount > 0
                ? `${staff.length - activeCount} deactivated`
                : "Everyone is active"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Owners
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{owners.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              {owners.length === 1 ? "The shop's only owner" : "Full access"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Can unlock the till
            </CardTitle>
            <KeyRound className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {staff.filter((s) => s.has_pin && s.is_active).length}
            </div>
            <p className="text-xs text-slate-500 mt-1">Have a PIN set</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Team</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">
              {staff.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {staff.length === 0 ? (
            <p className="p-12 text-center text-sm text-slate-500">Nobody on the team yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Works at</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => {
                  const location = locations.find((l) => l.id === member.location_id);
                  const isSelf = member.id === currentUserId;
                  const isLastOwner = member.role === "owner" && owners.length === 1;

                  return (
                    <TableRow key={member.id} data-inactive={!member.is_active}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-300">
                            {(member.name ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {member.name ?? "Unnamed"}
                              {isSelf && (
                                <span className="ml-1.5 text-xs font-normal text-slate-400">
                                  (you)
                                </span>
                              )}
                            </div>
                            {member.email && (
                              <div className="text-xs text-slate-500 truncate">{member.email}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                          {member.role}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                        {location ? location.name : "All locations"}
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {member.login_enabled && (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <UserCheck className="h-3 w-3" /> Dashboard
                            </Badge>
                          )}
                          {member.has_pin && (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <KeyRound className="h-3 w-3" /> Till PIN
                            </Badge>
                          )}
                          {!member.login_enabled && !member.has_pin && (
                            <span className="text-xs text-slate-400">No access yet</span>
                          )}
                          {!member.is_active && (
                            <Badge variant="destructive" className="text-xs">
                              Deactivated
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => openEdit(member)}
                              className="gap-1.5"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setPinFor(member);
                                setPin("");
                                setPinConfirm("");
                                setNotice(null);
                              }}
                              className="gap-1.5"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              {member.has_pin ? "Change PIN" : "Set PIN"}
                            </Button>

                            {member.has_pin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => run(() => clearStaffPin(member.id))}
                              >
                                Clear PIN
                              </Button>
                            )}

                            <Button
                              variant={member.is_active ? "ghost" : "outline"}
                              size="sm"
                              // The database refuses both of these anyway; disabling
                              // here explains why instead of waiting for an error.
                              disabled={pending || (member.is_active && (isSelf || isLastOwner))}
                              title={
                                isSelf
                                  ? "You cannot deactivate yourself"
                                  : isLastOwner
                                    ? "This is the shop's only owner"
                                    : undefined
                              }
                              onClick={() => run(() => setStaffActive(member.id, !member.is_active))}
                            >
                              {member.is_active ? "Deactivate" : "Reactivate"}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---------- add / edit ---------- */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          <form onSubmit={submitForm} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{isNew ? "Add staff member" : `Edit ${editing?.name}`}</DialogTitle>
              <DialogDescription>
                {isNew
                  ? "They'll be able to work the till once you give them a PIN."
                  : "Changing a role takes effect the next time they sign in."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="st-name">Name</Label>
              <Input
                id="st-name"
                required
                autoFocus
                placeholder="e.g. Faduma Hassan"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-role">Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as StaffRole })}
              >
                <SelectTrigger id="st-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">Cashier</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{ROLE_HELP[form.role]}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-loc">Works at</Label>
              <Select
                value={form.locationId}
                onValueChange={(v) => setForm({ ...form, locationId: v })}
              >
                <SelectTrigger id="st-loc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Pinning someone to one location limits what stock they see and where their
                sales land.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="st-email">Email (optional)</Label>
              <Input
                id="st-email"
                type="email"
                placeholder="Only if they need the dashboard"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <p className="text-xs text-slate-500">
                Recording an email here doesn&apos;t create a login on its own — they still
                need to sign up with it.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeForm} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : isNew ? "Add to team" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- PIN ---------- */}
      <Dialog open={pinFor !== null} onOpenChange={(open) => !open && setPinFor(null)}>
        <DialogContent className="max-w-sm">
          <form onSubmit={submitPin} className="space-y-4">
            <DialogHeader>
              <DialogTitle>PIN for {pinFor?.name}</DialogTitle>
              <DialogDescription>
                Four to eight digits. This unlocks the till on a device that&apos;s already
                signed in — it isn&apos;t a password, so keep it short enough to type at a
                counter.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="pin-1">New PIN</Label>
              <Input
                id="pin-1"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4,8}"
                required
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="font-mono tracking-[0.4em] text-center text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pin-2">Confirm</Label>
              <Input
                id="pin-2"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                required
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                className="font-mono tracking-[0.4em] text-center text-lg"
              />
            </div>

            {pin && pinConfirm && pin !== pinConfirm && (
              <p className="text-xs text-rose-600">Those don&apos;t match.</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPinFor(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || pin.length < 4}>
                {pending ? "Saving…" : "Set PIN"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
