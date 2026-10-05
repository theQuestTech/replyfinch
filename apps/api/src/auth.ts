import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface AgentClaims {
  typ: 'agent';
  sub: string; // user id
  acc: string; // account id
  name: string;
}

export interface VisitorClaims {
  typ: 'visitor';
  sub: string; // visitor id
  acc: string;
}

export function createAuth(secret: string) {
  return {
    signAgent: (c: Omit<AgentClaims, 'typ'>) => jwt.sign({ ...c, typ: 'agent' }, secret, { expiresIn: '7d' }),
    // Visitor tokens live in the visitor's browser for a year, like a first-party cookie.
    signVisitor: (c: Omit<VisitorClaims, 'typ'>) => jwt.sign({ ...c, typ: 'visitor' }, secret, { expiresIn: '365d' }),
    verifyAgent(token: string | undefined): AgentClaims | null {
      return verify<AgentClaims>(token, secret, 'agent');
    },
    verifyVisitor(token: string | undefined): VisitorClaims | null {
      return verify<VisitorClaims>(token, secret, 'visitor');
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;

function verify<T extends { typ: string }>(token: string | undefined, secret: string, typ: T['typ']): T | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret) as T;
    return decoded.typ === typ ? decoded : null;
  } catch {
    return null;
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
