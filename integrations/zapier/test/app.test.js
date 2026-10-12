const { test } = require('node:test');
const assert = require('node:assert/strict');
// The same check `zapier validate` runs: functions are swapped for placeholders first.
const { compileApp, validateApp } = require('zapier-platform-core/src/tools/schema');
const app = require('..');
const shape = require('../shape');

test('the app definition passes Zapier’s schema', () => {
  const errors = validateApp(compileApp(app));
  assert.deepEqual(errors.map((e) => `${e.property}: ${e.message}`), []);
});

test('has a trigger per Replyfinch event and a Create Ticket action', () => {
  assert.deepEqual(Object.keys(app.triggers).sort(), [
    'chat_ended',
    'chat_rated',
    'chat_started',
    'offline_message',
    'ticket_created',
    'ticket_customer_replied',
    'ticket_status_changed',
  ]);
  assert.equal(app.creates.ticket.display.label, 'Create Ticket');
});

/** A stand-in for Zapier's `z`, recording requests. */
function fakeZ(reply) {
  const calls = [];
  return {
    calls,
    request: async (req) => {
      calls.push(req);
      return { status: 200, data: reply(req) };
    },
    errors: { Error },
  };
}

test('subscribes and unsubscribes with REST hooks', async () => {
  const z = fakeZ(() => ({ id: 'wh_1' }));
  const trig = app.triggers.ticket_created.operation;
  const sub = await trig.performSubscribe(z, { targetUrl: 'https://hooks.zapier.com/abc' });
  assert.deepEqual(sub, { id: 'wh_1' });
  assert.match(z.calls[0].url, /\/v1\/hooks$/);
  assert.deepEqual(z.calls[0].body, { url: 'https://hooks.zapier.com/abc', event: 'ticket.created' });
  await trig.performUnsubscribe(z, { subscribeData: { id: 'wh_1' } });
  assert.equal(z.calls[1].method, 'DELETE');
  assert.match(z.calls[1].url, /\/v1\/hooks\/wh_1$/);
});

test('shapes a chat.ended event with a readable transcript', async () => {
  const event = {
    id: 'evt_1',
    type: 'chat.ended',
    createdAt: '2026-10-12T10:00:00.000Z',
    data: {
      conversation: { id: 'cnv_1', status: 'ended', department: 'Billing', assigneeName: 'Maya', rating: null, ratingComment: null },
      customer: { id: 'vis_1', name: 'Emma', email: 'emma@example.com', phone: null },
      messages: [
        { authorType: 'visitor', authorName: 'Emma', body: 'Hi' },
        { authorType: 'system', authorName: 'Maya', body: 'Maya joined the chat' },
        { authorType: 'agent', authorName: 'Maya', body: 'Hello!' },
      ],
    },
  };
  const [out] = await app.triggers.chat_ended.operation.perform({}, { cleanedRequest: event });
  assert.equal(out.id, 'evt_1');
  assert.equal(out.customer_email, 'emma@example.com');
  assert.equal(out.transcript, 'Emma: Hi\nMaya: Hello!');
  assert.equal(out.data, event.data);
});

test('shapes ticket events and lists samples', async () => {
  const ticket = { id: 'tk_1', number: 7, subject: 'Refund', status: 'solved', priority: 'high', assigneeName: null, requesterName: 'Lee', requesterEmail: 'lee@example.com', source: 'email' };
  const out = shape({ id: 'evt_2', type: 'ticket.status_changed', createdAt: 'x', data: { ticket, previousStatus: 'open' } });
  assert.equal(out.ticket_number, 7);
  assert.equal(out.previous_status, 'open');
  const z = fakeZ(() => [{ id: 'tk_1', type: 'ticket.created', createdAt: 'x', data: { ticket } }]);
  const list = await app.triggers.ticket_created.operation.performList(z, {});
  assert.match(z.calls[0].url, /\/v1\/samples\/ticket\.created$/);
  assert.equal(list[0].subject, 'Refund');
});

test('Create Ticket sends the fields', async () => {
  const z = fakeZ((req) => ({ id: 'tk_9', ...req.body }));
  const out = await app.creates.ticket.operation.perform(z, { inputData: { subject: 'From a form', email: 'a@b.co', priority: 'urgent' } });
  assert.match(z.calls[0].url, /\/v1\/tickets$/);
  assert.deepEqual(z.calls[0].body, { subject: 'From a form', description: '', name: undefined, email: 'a@b.co', priority: 'urgent' });
  assert.equal(out.id, 'tk_9');
});

test('adds the API key and explains bad keys', () => {
  const req = app.beforeRequest[0]({ headers: {} }, {}, { authData: { apiKey: 'rf_live_x' } });
  assert.equal(req.headers.Authorization, 'Bearer rf_live_x');
  const z = { errors: { Error: class extends Error {} } };
  assert.throws(() => app.afterResponse[0]({ status: 401 }, z), /invalid or was revoked/);
  assert.throws(() => app.afterResponse[0]({ status: 400, data: { error: 'Add a subject' } }, z), /Add a subject/);
  assert.equal(app.afterResponse[0]({ status: 200 }, z).status, 200);
});
