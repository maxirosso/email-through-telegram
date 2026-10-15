import { DeliveryStatus, Prisma, PrismaClient } from "@prisma/client";
import { accessTokenForAccount } from "@/auth/microsoft-tokens";
import type { ProviderMessage } from "@/providers/email-provider";
import { MicrosoftGraphProvider } from "@/providers/microsoft-graph";
import { sendTelegramMessage } from "@/telegram/client";
import { incomingEmailMessage } from "@/telegram/format";
import { recordOperationalAlert } from "./alerts";

const MAX_DELTA_PAGES = 100;

function cleanPreview(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 4000);
}

export class MailSyncService {
  constructor(private readonly prisma: PrismaClient) {}

  async processProviderMessage(accountId: string, message: ProviderMessage, shouldNotify = true): Promise<boolean> {
    const provider = new MicrosoftGraphProvider(await accessTokenForAccount(accountId));
    const attachments = message.hasAttachments
      ? (await provider.listMessageAttachments(message.id)).filter((item) => !item.inline)
      : [];

    const stored = await this.prisma.emailMessage.upsert({
      where: { accountId_providerMessageId: { accountId, providerMessageId: message.id } },
      create: {
        accountId,
        providerMessageId: message.id,
        conversationId: message.conversationId,
        internetMessageId: message.internetMessageId,
        senderName: message.sender.name,
        senderAddress: message.sender.address,
        replyTo: message.replyTo as Prisma.InputJsonValue,
        recipients: message.recipients as Prisma.InputJsonValue,
        subject: message.subject,
        sanitizedPreview: cleanPreview(message.bodyPreview),
        receivedAt: message.receivedAt,
        providerWebLink: message.webLink,
        hasAttachments: attachments.length > 0,
      },
      update: {
        conversationId: message.conversationId,
        internetMessageId: message.internetMessageId,
        senderName: message.sender.name,
        senderAddress: message.sender.address,
        replyTo: message.replyTo as Prisma.InputJsonValue,
        recipients: message.recipients as Prisma.InputJsonValue,
        subject: message.subject,
        sanitizedPreview: cleanPreview(message.bodyPreview),
        receivedAt: message.receivedAt,
        providerWebLink: message.webLink,
        hasAttachments: attachments.length > 0,
      },
    });

    if (attachments.length) {
      await Promise.all(attachments.map((item) => this.prisma.emailAttachment.upsert({
        where: { id: `${stored.id}:${item.id}` },
        create: {
          id: `${stored.id}:${item.id}`,
          messageId: stored.id,
          providerAttachmentId: item.id,
          filename: item.filename,
          mimeType: item.mimeType,
          sizeBytes: BigInt(item.sizeBytes),
        },
        update: { filename: item.filename, mimeType: item.mimeType, sizeBytes: BigInt(item.sizeBytes) },
      })));
    }

    if (shouldNotify) await this.notify(stored.id);
    return true;
  }

  async processMessageId(accountId: string, providerMessageId: string): Promise<boolean> {
    const provider = new MicrosoftGraphProvider(await accessTokenForAccount(accountId));
    try {
      return await this.processProviderMessage(accountId, await provider.getMessage(providerMessageId));
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) return false;
      throw error;
    }
  }

  async syncAccount(accountId: string): Promise<{ initialized: boolean; processed: number }> {
    const account = await this.prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId }, include: { syncCheckpoint: true },
    });
    if (!account.enabled) return { initialized: Boolean(account.syncCheckpoint?.providerCursor), processed: 0 };
    const provider = new MicrosoftGraphProvider(await accessTokenForAccount(accountId));
    const initializing = !account.syncCheckpoint?.providerCursor;
    let cursor = account.syncCheckpoint?.providerCursor ?? undefined;
    let finalCursor: string | undefined;
    let processed = 0;

    for (let pageNumber = 0; pageNumber < MAX_DELTA_PAGES; pageNumber += 1) {
      const page = await provider.listMessageDelta(cursor);
      for (const message of page.messages) {
        await this.processProviderMessage(accountId, message, !initializing);
        processed += 1;
      }
      if (page.deltaLink) {
        finalCursor = page.deltaLink;
        break;
      }
      if (!page.nextLink) throw new Error("Microsoft delta response had no continuation cursor");
      cursor = page.nextLink;
    }
    if (!finalCursor) throw new Error("Microsoft delta synchronization exceeded the page safety limit");

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.syncCheckpoint.upsert({
        where: { accountId },
        create: { accountId, providerCursor: finalCursor, lastSyncedAt: now },
        update: { providerCursor: finalCursor, lastSyncedAt: now, errorState: null },
      }),
      this.prisma.emailAccount.update({
        where: { id: accountId }, data: { syncCursor: finalCursor, lastSyncedAt: now, connectionStatus: "CONNECTED" },
      }),
    ]);
    return { initialized: true, processed };
  }

  async retryDelivery(messageId: string): Promise<void> {
    await this.notify(messageId);
  }

  private async notify(messageId: string): Promise<void> {
    const message = await this.prisma.emailMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: {
        attachments: true,
        account: { include: { user: { include: { destinations: true } } } },
      },
    });
    if (!message.account.notificationsOn) return;

    for (const destination of message.account.user.destinations.filter((item) => item.enabled && item.pairedAt)) {
      const delivery = await this.prisma.notificationDelivery.upsert({
        where: { messageId_destinationId: { messageId, destinationId: destination.id } },
        create: { messageId, destinationId: destination.id },
        update: {},
      });
      if (delivery.status === DeliveryStatus.SENT || delivery.status === DeliveryStatus.SENDING) continue;
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: { id: delivery.id, status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED] } },
        data: { status: DeliveryStatus.SENDING, attempts: { increment: 1 }, lastError: null },
      });
      if (claimed.count !== 1) continue;
      try {
        const result = await sendTelegramMessage(
          destination.chatId,
          incomingEmailMessage({
            senderName: message.senderName,
            senderAddress: message.senderAddress,
            subject: message.subject,
            preview: message.sanitizedPreview,
            receivedAt: message.receivedAt,
            attachmentCount: message.attachments.length,
          }),
          [
            [{ text: "📖 Read full email", callback_data: `read:${message.id}` }],
            [
            { text: "↩️ Reply", callback_data: `reply:${message.id}` },
            { text: "↩️ Reply all", callback_data: `replyall:${message.id}` },
            ],
            ...(message.attachments.length ? [[{ text: "📎 Attachments", callback_data: `files:${message.id}` }]] : []),
          ],
        );
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id }, data: { status: DeliveryStatus.SENT, telegramMessageId: BigInt(result.message_id) },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: DeliveryStatus.FAILED, lastError: detail },
        });
        await recordOperationalAlert({
          userId: message.account.userId, accountId: message.accountId,
          dedupeKey: `delivery:${delivery.id}`, kind: "DELIVERY_FAILED",
          title: "Telegram delivery failed", message: detail,
        });
        throw error;
      }
    }
  }
}
