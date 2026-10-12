const authentication = require('./authentication');
const triggers = require('./triggers');
const ticket = require('./creates/ticket');

/** Every request carries the customer's Replyfinch API key. */
const addApiKey = (request, z, bundle) => {
  request.headers = { ...request.headers, Authorization: `Bearer ${bundle.authData.apiKey}` };
  return request;
};

/** Clear messages instead of raw HTTP errors. */
const explainErrors = (response, z) => {
  if (response.status === 401) throw new z.errors.Error('Your Replyfinch API key is invalid or was revoked. Create a new one in Settings → Integrations.', 'AuthenticationError', 401);
  if (response.status >= 400) {
    const message = (response.data && response.data.error) || `Replyfinch answered ${response.status}`;
    throw new z.errors.Error(message, 'ReplyfinchError', response.status);
  }
  return response;
};

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addApiKey],
  afterResponse: [explainErrors],
  triggers,
  creates: { [ticket.key]: ticket },
};
