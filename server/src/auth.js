import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { getEnv } from './env.js';

const LoginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8)
});

const SignupSchema = z.object({
  name: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']).default('free')
});

export function parseSignup(body) {
  return SignupSchema.parse(body);
}

export function parseLogin(body) {
  return LoginSchema.parse(body);
}

export function createSessionToken({ userId }) {
  const env = getEnv();
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '30d' });
}

export function verifySessionToken(token) {
  const env = getEnv();
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (!payload || typeof payload !== 'object') return null;
  if (!('sub' in payload)) return null;
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) return null;
  return { userId: sub };
}

export async function hashPassword(password) {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function getCookieOptions() {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}
