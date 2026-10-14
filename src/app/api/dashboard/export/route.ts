import { requireDashboardUser } from "@/auth/dashboard-session";
import { exportTenantData } from "@/services/tenant-operations";
import { writeAudit } from "@/services/audit";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireDashboardUser();
  const payload = await exportTenantData(user.id);
  await writeAudit({ userId: user.id, actorAuthUserId: user.authUserId, action: "DATA_EXPORTED", entityType: "ApplicationUser", entityId: user.id });
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mailpulse-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
