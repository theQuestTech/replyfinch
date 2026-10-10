import type { Message } from '@replyfinch/shared';
import { offlineReplyEmail, testEmail, transcriptEmail, type Mailer } from '../email';
import type { ConversationService } from './conversations';
import type { OfflineService } from './offline';
import type { WidgetSettingsService } from './widget-settings';

type ConvRow = NonNullable<Awaited<ReturnType<ConversationService['get']>>>;

/** The emails Replyfinch sends, shared by the agent API and the widget socket. */
export function createMailActions(d: {
  mailer: Mailer;
  conversations: ConversationService;
  offline: OfflineService;
  widgetSettings: WidgetSettingsService;
}) {
  const brand = async (acc: string) => {
    const s = await d.widgetSettings.withName(acc);
    return { accountName: s.accountName, color: s.color ?? '#14213D' };
  };

  return {
    /** Email a chat to `to`, and leave an agents-only note in it. */
    async sendTranscript(acc: string, conv: ConvRow, to: string, customerName: string | null, by: { id: string | null; name: string }): Promise<Message> {
      const messages = await d.conversations.listMessages(conv.id, { includeInternal: false });
      const email = transcriptEmail({ ...(await brand(acc)), customerName, startedAt: conv.startedAt.getTime(), messages });
      await d.mailer.send({ ...email, to });
      return d.conversations.note(conv, by, `Transcript emailed to ${to}`);
    },

    async replyToOffline(acc: string, id: string, author: { id: string; name: string }, body: string) {
      const m = await d.offline.get(acc, id);
      if (!m) return null;
      const email = offlineReplyEmail({
        ...(await brand(acc)),
        customerName: m.name,
        agentName: author.name,
        body,
        original: { message: m.message, createdAt: m.createdAt.getTime() },
      });
      await d.mailer.send({ ...email, to: m.email });
      const reply = await d.offline.addReply(acc, id, author, m.email, body);
      const updated = await d.offline.setStatus(acc, id, 'handled', author.id);
      return { reply, message: updated! };
    },

    async sendTest(acc: string, to: string) {
      const b = await brand(acc);
      await d.mailer.send({ ...testEmail(b.accountName, b.color), to });
    },
  };
}
export type MailActions = ReturnType<typeof createMailActions>;
