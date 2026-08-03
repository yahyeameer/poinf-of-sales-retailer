import { Shell } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";

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
      <h1>Staff & Permissions</h1>
      <p className="subtitle">Manage shop staff, roles, and device access control.</p>

      <section className="panel">
        <header>
          <span>Team Members ({staffMembers.length})</span>
        </header>

        {staffMembers.length === 0 ? (
          <p className="empty">No staff members found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {staffMembers.map((member) => (
                <tr key={member.id}>
                  <td style={{ fontWeight: 550 }}>{member.name || "Unnamed Staff"}</td>
                  <td>
                    <span className="pill">{member.role}</span>
                  </td>
                  <td>{new Date(member.created_at).toLocaleDateString()}</td>
                  <td>
                    <span className="pill" style={{ color: "var(--accent)" }}>
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
