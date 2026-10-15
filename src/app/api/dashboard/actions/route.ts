import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardUser } from "@/auth/dashboard-session";
import { createTelegramPairingCode } from "@/services/telegram-pairing";
import {
  acknowledgeTenantAlert, approveClient, createTenantSupportCase, retryTenantDelivery, runTenantRetention,
  setTenantAccountEnabled, setTenantDeletionRequest, updateTenantSettings,
} from "@/services/tenant-operations";

export const runtime = "nodejs";

function dashboard(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("result", result);
  return NextResponse.redirect(url, { status: 303 });
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("INVALID_ORIGIN");
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireDashboardUser();
    const form = await request.formData();
    const action = z.string().max(40).parse(form.get("action"));
    if (action === "approve-client") {
      if (!user.isPlatformAdmin) return dashboard(request, "admin-required");
      const values = z.object({
        email: z.string().trim().email().max(320),
        displayName: z.string().trim().max(120).optional(),
      }).parse({
        email: form.get("email"),
        displayName: form.get("displayName") || undefined,
      });
      await approveClient(user.id, values.email, values.displayName);
      return dashboard(request, "client-approved");
    }
    if (action === "pair") {
      const pairing = await createTelegramPairingCode(user.id);
      return dashboard(request, `pair:${pairing.code}`);
    }
    if (action === "settings") {
      const values = z.object({
        timezone: z.string().min(1).max(100), undoSendSeconds: z.coerce.number().int().min(1).max(300),
        messageRetentionDays: z.coerce.number().int().min(7).max(3650),
        auditRetentionDays: z.coerce.number().int().min(30).max(3650),
      }).parse(Object.fromEntries(form));
      await updateTenantSettings(user.id, { ...values, alertOnFailure: form.get("alertOnFailure") === "on" }, user.authUserId);
      return dashboard(request, "settings-saved");
    }
    if (action === "request-deletion") await setTenantDeletionRequest(user.id, true, user.authUserId);
    else if (action === "cancel-deletion") await setTenantDeletionRequest(user.id, false, user.authUserId);
    else if (action === "retention") await runTenantRetention(user.id);
    else if (action === "support") {
      const subject = z.string().min(3).max(160).parse(form.get("subject"));
      const message = z.string().min(10).max(5000).parse(form.get("message"));
      await createTenantSupportCase(user.id, subject, message, user.authUserId);
    } else {
      const id = z.string().min(1).max(191).parse(form.get("id"));
      if (action === "ack-alert") await acknowledgeTenantAlert(user.id, id, user.authUserId);
      else if (action === "retry-delivery") await retryTenantDelivery(user.id, id, user.authUserId);
      else if (action === "disconnect-account") await setTenantAccountEnabled(user.id, id, false, user.authUserId);
      else return dashboard(request, "invalid-action");
    }
    return dashboard(request, `${action}-ok`);
  } catch {
    return dashboard(request, "error");
  }
}
