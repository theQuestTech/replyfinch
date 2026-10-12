const { API_URL } = require('../config');

module.exports = {
  key: 'ticket',
  noun: 'Ticket',
  display: { label: 'Create Ticket', description: 'Creates a ticket in Replyfinch (for example from a form, a spreadsheet row or an email).' },
  operation: {
    inputFields: [
      { key: 'subject', label: 'Subject', required: true },
      { key: 'description', label: 'Description', type: 'text', helpText: 'An internal note on the ticket. Only your team sees it.' },
      { key: 'name', label: 'Customer name' },
      { key: 'email', label: 'Customer email', helpText: 'So your team can reply by email. Links the ticket to the customer with this email.' },
      { key: 'priority', label: 'Priority', choices: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }, default: 'normal' },
    ],
    perform: async (z, bundle) =>
      (
        await z.request({
          url: `${API_URL}/v1/tickets`,
          method: 'POST',
          body: {
            subject: bundle.inputData.subject,
            description: bundle.inputData.description || '',
            name: bundle.inputData.name || undefined,
            email: bundle.inputData.email || undefined,
            priority: bundle.inputData.priority || 'normal',
          },
        })
      ).data,
    sample: { id: 'tk_sample', number: 42, subject: 'Damaged copy', status: 'open', priority: 'normal', requesterName: 'Olivia Garcia', requesterEmail: 'olivia@example.com', source: 'api' },
  },
};
