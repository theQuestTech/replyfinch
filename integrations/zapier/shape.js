// Turns a Replyfinch event into what Zaps see: the useful fields at the top, everything else under "data".

const transcript = (messages = []) =>
  messages
    .filter((m) => m.authorType !== 'system')
    .map((m) => `${m.authorName}: ${m.body}`)
    .join('\n');

module.exports = function shape(event) {
  const d = event.data || {};
  const out = { id: event.id, type: event.type, created_at: event.createdAt };
  if (d.conversation) {
    Object.assign(out, {
      conversation_id: d.conversation.id,
      status: d.conversation.status,
      department: d.conversation.department,
      agent_name: d.conversation.assigneeName,
      rating: d.conversation.rating,
      rating_comment: d.conversation.ratingComment,
      customer_name: d.customer && d.customer.name,
      customer_email: d.customer && d.customer.email,
      customer_phone: d.customer && d.customer.phone,
    });
    if (d.messages) out.transcript = transcript(d.messages);
  }
  if (d.offlineMessage) {
    const m = d.offlineMessage;
    Object.assign(out, { offline_message_id: m.id, customer_name: m.name, customer_email: m.email, customer_phone: m.phone, department: m.department, message: m.message, page_url: m.pageUrl });
  }
  if (d.ticket) {
    const t = d.ticket;
    Object.assign(out, {
      ticket_id: t.id,
      ticket_number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignee_name: t.assigneeName,
      customer_name: t.requesterName,
      customer_email: t.requesterEmail,
      source: t.source,
    });
    if (d.previousStatus) out.previous_status = d.previousStatus;
    if (d.message) out.reply = d.message.body;
  }
  out.data = d;
  return out;
};
