const { API_URL } = require('./config');

// Customers paste an API key from Replyfinch → Settings → Integrations → API keys.
module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      required: true,
      type: 'password',
      helpText: 'In Replyfinch, go to **Settings → Integrations → API keys**, create a key (for example “Zapier”) and paste it here.',
    },
  ],
  test: { url: `${API_URL}/v1/me` },
  connectionLabel: '{{account.name}}',
};
