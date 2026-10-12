// The Replyfinch API. Override with `zapier env:set 1.0.0 REPLYFINCH_API_URL=…` if it moves.
module.exports = {
  API_URL: (process.env.REPLYFINCH_API_URL || 'https://replyfinch-production.up.railway.app').replace(/\/$/, ''),
};
