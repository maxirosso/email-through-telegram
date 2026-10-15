import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertUpdateMany: vi.fn(), accountUpdateMany: vi.fn(), deliveryFindFirst: vi.fn(),
  auditCreate: vi.fn(), deliveryUpdate: vi.fn(), transaction: vi.fn(),
  userFindFirst: vi.fn(), userUpsert: vi.fn(), settingsUpsert: vi.fn(), billingUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    alertEvent: { updateMany: mocks.alertUpdateMany },
    emailAccount: { updateMany: mocks.accountUpdateMany },
    notificationDelivery: { findFirst: mocks.deliveryFindFirst, update: mocks.deliveryUpdate },
    auditEvent: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("./mail-sync", () => ({ MailSyncService: class { retryDelivery = vi.fn(); } }));

import { acknowledgeTenantAlert, approveClient, retryTenantDelivery, setTenantAccountEnabled } from "./tenant-operations";

describe("tenant operation isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditCreate.mockResolvedValue({ id: "audit" });
    mocks.transaction.mockImplementation((operation) => operation({
      applicationUser: { findFirst: mocks.userFindFirst, upsert: mocks.userUpsert },
      applicationSettings: { upsert: mocks.settingsUpsert },
      billingSubscription: { upsert: mocks.billingUpsert },
      auditEvent: { create: mocks.auditCreate },
    }));
  });

  it("cannot acknowledge an alert owned by another tenant", async () => {
    mocks.alertUpdateMany.mockImplementation(({ where }) => Promise.resolve({
      count: where.id === "alert-b" && where.userId === "tenant-b" ? 1 : 0,
    }));
    await expect(acknowledgeTenantAlert("tenant-a", "alert-b")).resolves.toBe(false);
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "alert-b", userId: "tenant-a" }),
    }));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("cannot disconnect another tenant's mailbox", async () => {
    mocks.accountUpdateMany.mockImplementation(({ where }) => Promise.resolve({
      count: where.id === "account-b" && where.userId === "tenant-b" ? 1 : 0,
    }));
    await expect(setTenantAccountEnabled("tenant-a", "account-b", false)).resolves.toBe(false);
    expect(mocks.accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "account-b", userId: "tenant-a" },
    }));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("cannot retry another tenant's notification delivery", async () => {
    mocks.deliveryFindFirst.mockResolvedValue(null);
    await expect(retryTenantDelivery("tenant-a", "delivery-b")).resolves.toBe(false);
    expect(mocks.deliveryFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "delivery-b", destination: { userId: "tenant-a" } }),
    }));
    expect(mocks.deliveryUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("allows only a platform admin to approve a client", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    await expect(approveClient("ordinary-user", "client@example.com"))
      .rejects.toThrow("PLATFORM_ADMIN_REQUIRED");
    expect(mocks.userUpsert).not.toHaveBeenCalled();
  });

  it("atomically allowlists and provisions an approved client", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "admin", authUserId: "auth-admin" });
    mocks.userUpsert.mockResolvedValue({ id: "client", email: "client@example.com" });
    mocks.settingsUpsert.mockResolvedValue({ id: "settings" });
    mocks.billingUpsert.mockResolvedValue({ id: "billing" });

    await approveClient("admin", " CLIENT@Example.com ", "Client Name");

    expect(mocks.userUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: "client@example.com" },
      create: expect.objectContaining({ email: "client@example.com", displayName: "Client Name" }),
    }));
    expect(mocks.settingsUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "client" },
    }));
    expect(mocks.billingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "client" },
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "admin", action: "CLIENT_APPROVED", entityId: "client" }),
    }));
  });
});
