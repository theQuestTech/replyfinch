import { describe, expect, it } from 'vitest';
import { parseOrigins } from '../src/env';

describe('parseOrigins', () => {
  it('normalises what people paste into hosting dashboards', () => {
    expect(parseOrigins('https://replyfinch-web.vercel.app/')).toEqual(['https://replyfinch-web.vercel.app']);
    expect(parseOrigins('"https://replyfinch-web.vercel.app/login"')).toEqual(['https://replyfinch-web.vercel.app']);
    expect(parseOrigins('replyfinch-web.vercel.app')).toEqual(['https://replyfinch-web.vercel.app']);
    expect(parseOrigins(' https://a.com , http://localhost:5173 ')).toEqual(['https://a.com', 'http://localhost:5173']);
  });
});
