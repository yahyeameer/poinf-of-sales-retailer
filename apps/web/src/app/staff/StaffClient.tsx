"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Pencil,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/LocalTime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
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
  clearStaffPin,
  saveStaff,
  setStaffActive,
  setStaffPin,
  requireStaffPinChange,
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
  /** From v_staff_pin_status. See staff/page.tsx for why these are not
   *  derived in the browser. */
  pin_set_at: string | null;
  pin_last_used_at: string | null;
  must_change_pin: boolean;
  pin_never_used: boolean;
  can_manage_pin: boolean;
}

export interface PinEvent {
  id: string;
  action: string;
  created_at: string;
  actor: string;
  target: string;
}

const PIN_EVENT_WORDING: Record<string, string> = {
  issued: "issued a PIN to",
  cleared: "removed the PIN of",
  reset_required: "asked for a new PIN from",
  changed_by_self: "changed their own PIN",
};

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
  canManageAnyPin,
  pinEvents,
  currentUserId,
}: {
  staff: StaffMember[];
  locations: ShopLocation[];
  canEdit: boolean;
  canManageAnyPin: boolean;
  pinEvents: PinEvent[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
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
      toast(result);
      if (result.ok) {
        closeForm();
        router.refresh();
      }
    });
  }

  function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== pinConfirm) {
      toast({ ok: false, message: "The two PINs don't match." });
      return;
    }
    const target = pinFor;
    if (!target) return;

    startTransition(async () => {
      const result = await setStaffPin(target.id, pin);
      toast(result);
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
      toast(result);
      if (result.ok) router.refresh();
    });
  }

  const formOpen = isNew || editing !== null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gradient">
            <Users className="size-6 text-primary" />
            Staff &amp; Permissions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
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

      {/* Two different read-only states now. A manager cannot edit staff
          records but can issue and clear cashiers' PINs, and telling them they
          can only look would send them to find the owner for something they
          are able to do themselves. */}
      {!canEdit && (
        <div className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
          {canManageAnyPin
            ? "Only an owner can add or change staff records. You can still set and clear till PINs for cashiers."
            : "Only an owner can add or change staff. You can see who's on the team."}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active staff
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {staff.length - activeCount > 0
                ? `${staff.length - activeCount} deactivated`
                : "Everyone is active"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Owners
            </CardTitle>
            <ShieldCheck className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{owners.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {owners.length === 1 ? "The shop's only owner" : "Full access"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Can unlock the till
            </CardTitle>
            <KeyRound className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {staff.filter((s) => s.has_pin && s.is_active).length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Have a PIN set</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Team</CardTitle>
            <Badge variant="outline" className="font-mono text-xs">
              {staff.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {staff.length === 0 ? (
            <EmptyState icon={UserPlus} title="Nobody on the team yet" description="Add a cashier or manager and they will show up here." />
          ) : (
            /* A list of cards, not a table.
             *
             * It was a five-column table with no horizontal scroll and no
             * mobile layout, so on a phone the Actions column — which holds
             * every PIN control there is — was simply off the right edge of
             * the screen. The controls existed and could not be reached, which
             * is indistinguishable from their not existing.
             *
             * Cards rather than a scrolling table because this is a handful of
             * rows with several actions each, which is the shape a table is
             * worst at. Each person is one block that reads top to bottom on a
             * phone and sits two-up on a laptop. */
            <ul className="divide-y divide-border">
              {staff.map((member) => {
                const location = locations.find((l) => l.id === member.location_id);
                const isSelf = member.id === currentUserId;
                const isLastOwner =
                  member.role === "owner" &&
                  staff.filter((s) => s.role === "owner" && s.is_active).length === 1;

                return (
                  <li
                    key={member.id}
                    data-inactive={!member.is_active}
                    className="p-4 data-[inactive=true]:opacity-60 sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{member.name || "Unnamed"}</span>
                          <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                            {member.role}
                          </Badge>
                          {isSelf && (
                            <span className="text-xs text-muted-foreground">(you)</span>
                          )}
                          {!member.is_active && (
                            <Badge variant="destructive" className="text-xs">
                              Deactivated
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {member.email || "No email — till only"}
                          {" · "}
                          {location ? location.name : "All locations"}
                        </p>
                      </div>

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
                          <span className="text-xs text-muted-foreground">No access yet</span>
                        )}
                      </div>
                    </div>

                    {/* What is true about their PIN, in words rather than a
                        timestamp nobody reads. A PIN cannot be looked up, so
                        this is the only visibility anyone gets into it. */}
                    {member.has_pin && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {member.must_change_pin ? (
                          <span className="text-warning-foreground">
                            Must choose a new PIN at the next till unlock.
                          </span>
                        ) : member.pin_never_used ? (
                          "PIN set but never used — they may not have been told it yet."
                        ) : (
                          <>
                            Last used <LocalTime value={member.pin_last_used_at!} format="datetime" />
                          </>
                        )}
                      </p>
                    )}

                    {(canEdit || member.can_manage_pin) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => openEdit(member)}
                            className="gap-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}

                        {/* can_manage_pin comes from the database, so a manager
                            is never offered a button on an owner's row that
                            the RPC would then refuse. */}
                        {member.can_manage_pin && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => {
                                setPinFor(member);
                                setPin("");
                                setPinConfirm("");
                              }}
                              className="gap-1.5"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              {member.has_pin ? "Change PIN" : "Set PIN"}
                            </Button>

                            {member.has_pin && !member.must_change_pin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => run(() => requireStaffPinChange(member.id))}
                                title="Keeps the current PIN working, but asks them to pick a new one next time."
                              >
                                Ask for a new one
                              </Button>
                            )}

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
                          </>
                        )}

                        {canEdit && (
                          <Button
                            variant={member.is_active ? "ghost" : "outline"}
                            size="sm"
                            // The database refuses both of these anyway; disabling
                            // here explains why instead of waiting for an error.
                            disabled={pending || (member.is_active && (isSelf || isLastOwner))}
                            title={
                              member.is_active && isSelf
                                ? "You cannot deactivate yourself."
                                : member.is_active && isLastOwner
                                  ? "A shop needs at least one active owner."
                                  : undefined
                            }
                            onClick={() => run(() => setStaffActive(member.id, !member.is_active))}
                          >
                            {member.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------- who changed whose PIN ----------
           A trail nobody can read is just storage. Owners and managers see it;
           RLS returns nothing to anyone else, so this simply does not render
           for them rather than needing a role check here. */}
      {pinEvents.length > 0 && (
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-base font-semibold">PIN activity</CardTitle>
            <p className="text-xs text-muted-foreground">
              Sales are recorded against whoever unlocks the till, so it matters who can
              hand out a PIN.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {pinEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                  <span className="font-medium">{e.actor}</span>
                  <span className="text-muted-foreground">
                    {PIN_EVENT_WORDING[e.action] ?? e.action}
                  </span>
                  {e.action !== "changed_by_self" && (
                    <span className="font-medium">{e.target}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    <LocalTime value={e.created_at} format="datetime" />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
              <p className="text-xs text-muted-foreground">{ROLE_HELP[form.role]}</p>
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
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
              <p className="text-xs text-destructive">Those don&apos;t match.</p>
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
