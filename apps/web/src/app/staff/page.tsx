import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ShieldCheck, UserCheck, UserPlus, Key } from "lucide-react";

export const dynamic = "force-dynamic";

const DEMO_STAFF = [
  { id: "u1", name: "Shop Owner (Demo)", role: "owner", created_at: new Date(Date.now() - 86400000 * 30).toISOString() },
  { id: "u2", name: "Cashier Alice", role: "cashier", created_at: new Date(Date.now() - 86400000 * 14).toISOString() },
  { id: "u3", name: "Inventory Bob", role: "cashier", created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
];

export default async function StaffPage() {
  let staffMembers = DEMO_STAFF;
  let shopName = "Demo Retail Shop";

  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenants").select("name").single();
    if (tenant?.name) shopName = tenant.name;

    const { data: dbStaff } = await supabase
      .from("users")
      .select("id, name, role, created_at")
      .order("created_at", { ascending: true });

    if (dbStaff && dbStaff.length > 0) staffMembers = dbStaff;
  } catch {
    // Demo fallback for local development preview
  }

  return (
    <Shell shopName={shopName}>
      <div className="max-w-7xl mx-auto space-y-6 font-sans">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-2.5">
              <Users className="h-6 w-6 text-emerald-600" />
              Staff & Permissions
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Manage shop cashiers, manager roles, and register permissions.
            </p>
          </div>
          <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20">
            <UserPlus className="h-4 w-4" />
            <span>Add Staff Member</span>
          </Button>
        </div>

        {/* Roles Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Staff
              </CardTitle>
              <Users className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">{staffMembers.length}</div>
              <p className="text-xs text-slate-500 mt-1">Active team members</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Store Owner / Admin
              </CardTitle>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {staffMembers.filter((s) => s.role === "owner" || s.role === "manager").length || 1}
              </div>
              <p className="text-xs text-slate-500 mt-1">Full management access</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Active Cashiers
              </CardTitle>
              <UserCheck className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {staffMembers.filter((s) => s.role === "cashier").length}
              </div>
              <p className="text-xs text-slate-500 mt-1">Till checkout permissions</p>
            </CardContent>
          </Card>
        </div>

        {/* Staff Table */}
        <Card>
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Team Members</CardTitle>
              <Badge variant="outline" className="font-mono text-xs">{staffMembers.length} Members</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {staffMembers.length === 0 ? (
              <p className="p-12 text-center text-sm text-slate-500">No staff members found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Assigned Role</th>
                      <th className="px-5 py-3">Joined Date</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {staffMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3.5 font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300 text-xs">
                            {member.name ? member.name.charAt(0).toUpperCase() : "U"}
                          </div>
                          <span>{member.name || "Unnamed Staff"}</span>
                        </td>
                        <td className="px-5 py-3.5 capitalize">
                          <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                            {member.role}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500 font-mono">
                          {new Date(member.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">
                            Active
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
