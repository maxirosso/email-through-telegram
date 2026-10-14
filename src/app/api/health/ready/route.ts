import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Database readiness timed out")), 5_000)),
    ]);
    return NextResponse.json({ status: "ready", database: "connected" });
  } catch {
    return NextResponse.json({ status: "not_ready", database: "unavailable" }, { status: 503 });
  }
}
