const { API_URL } = require('../config');
const shape = require('../shape');

// One "instant" trigger per Replyfinch event (REST hooks: Zapier subscribes when a Zap is turned on).
const EVENTS = [
  ['chat_started', 'chat.started', 'Chat', 'New Chat', 'Triggers when a visitor starts a chat (or an agent starts one).'],
  ['chat_ended', 'chat.ended', 'Chat', 'Chat Ended', 'Triggers when a chat ends. Includes the transcript.'],
  ['chat_rated', 'chat.rated', 'Chat', 'Chat Rated', 'Triggers when a visitor rates a chat 👍 or 👎.'],
  ['offline_message', 'offline_message.created', 'Offline Message', 'New Offline Message', 'Triggers when a visitor leaves a message while nobody is online.'],
  ['ticket_created', 'ticket.created', 'Ticket', 'New Ticket', 'Triggers when a ticket is created.'],
  ['ticket_status_changed', 'ticket.status_changed', 'Ticket', 'Ticket Status Changed', 'Triggers when a ticket becomes open, pending or solved.'],
  ['ticket_customer_replied', 'ticket.customer_replied', 'Ticket', 'Customer Replied to Ticket', 'Triggers when a customer answers a ticket by email.'],
];

const SAMPLES = {
  Chat: { id: 'evt_sample', type: 'chat.ended', created_at: '2026-10-12T10:00:00.000Z', conversation_id: 'cnv_sample', status: 'ended', department: 'Orders & shipping', agent_name: 'Maya Chen', customer_name: 'Emma Wilson', customer_email: 'emma@example.com', transcript: 'Emma Wilson: Do you ship to Canada?\nMaya Chen: Yes — 5–8 working days.' },
  'Offline Message': { id: 'evt_sample', type: 'offline_message.created', created_at: '2026-10-12T10:00:00.000Z', offline_message_id: 'om_sample', customer_name: 'Pia Novak', customer_email: 'pia@example.com', message: 'Can I change my delivery address?' },
  Ticket: { id: 'evt_sample', type: 'ticket.created', created_at: '2026-10-12T10:00:00.000Z', ticket_id: 'tk_sample', ticket_number: 12, subject: 'Damaged copy', status: 'open', priority: 'high', customer_name: 'Olivia Garcia', customer_email: 'olivia@example.com' },
};

const make = ([key, event, noun, label, description]) => ({
  key,
  noun,
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: async (z, bundle) =>
      (await z.request({ url: `${API_URL}/v1/hooks`, method: 'POST', body: { url: bundle.targetUrl, event } })).data,
    performUnsubscribe: async (z, bundle) => (await z.request({ url: `${API_URL}/v1/hooks/${bundle.subscribeData.id}`, method: 'DELETE' })).data,
    // Zapier hands us the webhook body Replyfinch sent.
    perform: async (z, bundle) => [shape(bundle.cleanedRequest)],
    // Recent real examples while someone builds a Zap.
    performList: async (z) => (await z.request({ url: `${API_URL}/v1/samples/${event}` })).data.map(shape),
    sample: { ...SAMPLES[noun], type: event },
  },
});

module.exports = Object.fromEntries(EVENTS.map((e) => [e[0], make(e)]));
