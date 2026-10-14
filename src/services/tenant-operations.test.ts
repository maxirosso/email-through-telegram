import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertUpdateMany: vi.fn(), accountUpdateMany: vi.fn(), deliveryFindFirst: vi.fn(),
  auditCreate: vi.fn(), deliveryUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    alertEvent: { updateMany: mocks.alertUpdateMany },
    emailAccount: { updateMany: mocks.accountUpdateMany },
    notificationDelivery: { findFirst: mocks.deliveryFindFirst, update: mocks.deliveryUpdate },
    auditEvent: { create: mocks.auditCreate },
  },
}));

vi.mock("./mail-sync", () => ({ MailSyncService: class { retryDelivery = vi.fn(); } }));

import { acknowledgeTenantAlert, retryTenantDelivery, setTenantAccountEnabled } from "./tenant-operations";

describe("tenant operation isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditCreate.mockResolvedValue({ id: "audit" });
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
});
