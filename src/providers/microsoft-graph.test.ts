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

  it("fetches the complete plain-text body when opening one message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "message-1",
      sender: { emailAddress: { address: "sender@example.com" } },
      subject: "Long email",
      bodyPreview: "A short preview that stops",
      body: { content: "The complete email body continues through the final sentence." },
      receivedDateTime: "2026-10-15T15:49:33Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const body = await new MicrosoftGraphProvider("token").getMessageBody("message-1");

    expect(body).toBe("The complete email body continues through the final sentence.");
    expect(String(fetchMock.mock.calls[0][0])).toContain("$select=body");
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe('outlook.body-content-type="text"');
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

  it("creates a new Outlook draft with recipients, subject, and a text body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "draft-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await new MicrosoftGraphProvider("token").createDraft({
      recipients: [{ address: "client@example.com" }],
      subject: "A simple subject",
      body: "Hello from Telegram",
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://graph.microsoft.com/v1.0/me/messages");
    const request = fetchMock.mock.calls[0][1];
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body as string)).toEqual({
      subject: "A simple subject",
      body: { contentType: "Text", content: "Hello from Telegram" },
      toRecipients: [{ emailAddress: { address: "client@example.com" } }],
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
