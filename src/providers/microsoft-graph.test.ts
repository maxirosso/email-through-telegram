import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrosoftGraphProvider } from "./microsoft-graph";
import { ProviderRequestError } from "./email-provider";

afterEach(() => vi.unstubAllGlobals());

describe("MicrosoftGraphProvider", () => {
  it("normalizes a delta page and bounds initial synchronization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      value: [{
        id: "message-1",
        sender: { emailAddress: { name: "Sender", address: "sender@example.com" } },
        toRecipients: [{ emailAddress: { address: "owner@example.com" } }],
        subject: "Hello",
        bodyPreview: "Preview",
        receivedDateTime: "2026-10-14T10:00:00Z",
        hasAttachments: true,
      }],
      "@odata.deltaLink": "https://graph.microsoft.com/delta-token",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await new MicrosoftGraphProvider("token").listMessageDelta();

    expect(page.messages[0]).toMatchObject({
      id: "message-1", subject: "Hello", sender: { address: "sender@example.com" }, hasAttachments: true,
    });
    expect(page.deltaLink).toContain("delta-token");
    expect(String(fetchMock.mock.calls[0][0])).toContain("receivedDateTime%20ge%20");
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toContain("body-content-type");
  });

  it("sends the attachment filename and MIME type to Outlook", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "attachment-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await new MicrosoftGraphProvider("token").addDraftAttachment("draft-1", {
      filename: "IMG_20261014_185700_ABCD1234.jpg",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "IMG_20261014_185700_ABCD1234.jpg",
      contentType: "image/jpeg",
    });
  });

  it("treats an already-removed attachment as successfully removed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(new MicrosoftGraphProvider("token").removeDraftAttachment("draft", "attachment"))
      .resolves.toBeUndefined();
  });
  it("surfaces provider status without leaking authorization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    await expect(new MicrosoftGraphProvider("secret-token").getMessage("id"))
      .rejects.toEqual(expect.objectContaining<Partial<ProviderRequestError>>({ status: 403, responseBody: "denied" }));
  });
});