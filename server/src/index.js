import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';

import { parseLogin, parseSignup, createSessionToken, getCookieOptions, hashPassword, verifyPassword } from './auth.js';
import { getPrisma } from './db.js';
import { getEnv } from './env.js';
import { requireAuth } from './middleware.js';
import { addDays, getYearMonth } from './time.js';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// Validate env at startup (throws with readable errors)
const env = getEnv();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(cookieParser());
app.use('/api', express.json({ limit: '1mb' }));

// -------------------------
// Auth API
// -------------------------
app.post('/api/auth/signup', async (req, res) => {
  const prisma = getPrisma();

  let input;
  try {
    input = parseSignup(req.body);
  } catch (e) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return res.status(409).json({ error: 'email_in_use' });

  const passwordHash = await hashPassword(input.password);

  const trialEndsAt = input.plan === 'free' ? null : addDays(new Date(), 14);
  const status = input.plan === 'free' ? 'active' : 'trialing';

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      companyName: input.companyName,
      subscription: {
        create: {
          plan: input.plan,
          status,
          trialEndsAt
        }
      },
      usageMonths: {
        create: {
          yearMonth: getYearMonth(),
          servers: 0,
          plans: 0,
          reportsThisMonth: 0
        }
      },
      appState: {
        create: {
          data: {}
        }
      }
    },
    include: { subscription: true }
  });

  const token = createSessionToken({ userId: user.id });
  res.cookie(env.COOKIE_NAME, token, getCookieOptions());

  return res.json({
    user: { id: user.id, email: user.email, name: user.name, companyName: user.companyName },
    subscription: user.subscription
      ? {
          plan: user.subscription.plan,
          status: user.subscription.status,
          trialEndsAt: user.subscription.trialEndsAt
        }
      : null
  });
});

app.post('/api/auth/login', async (req, res) => {
  const prisma = getPrisma();

  let input;
  try {
    input = parseLogin(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { subscription: true }
  });
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  // Ensure default related rows exist (for old accounts)
  if (!user.subscription) {
    await prisma.subscription.create({
      data: { userId: user.id, plan: 'free', status: 'active' }
    });
  }

  const token = createSessionToken({ userId: user.id });
  res.cookie(env.COOKIE_NAME, token, getCookieOptions());

  return res.json({
    user: { id: user.id, email: user.email, name: user.name, companyName: user.companyName },
    subscription: user.subscription
      ? {
          plan: user.subscription.plan,
          status: user.subscription.status,
          trialEndsAt: user.subscription.trialEndsAt
        }
      : null
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(env.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { userId } = req.auth;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      usageMonths: { where: { yearMonth: getYearMonth() } },
      appState: true
    }
  });

  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const currentUsage = user.usageMonths[0] || null;

  return res.json({
    user: { id: user.id, email: user.email, name: user.name, companyName: user.companyName },
    subscription: user.subscription
      ? {
          plan: user.subscription.plan,
          status: user.subscription.status,
          trialEndsAt: user.subscription.trialEndsAt,
          currentPeriodEnd: user.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd
        }
      : null,
    usage: currentUsage
      ? {
          yearMonth: currentUsage.yearMonth,
          servers: currentUsage.servers,
          plans: currentUsage.plans,
          reportsThisMonth: currentUsage.reportsThisMonth,
          lastReportAt: currentUsage.lastReportAt
        }
      : { yearMonth: getYearMonth(), servers: 0, plans: 0, reportsThisMonth: 0, lastReportAt: null },
    appState: user.appState?.data ?? {}
  });
});

const staticRoot = path.resolve(__dirname, '../../');
app.use(express.static(staticRoot));

app.get('/', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'landing.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`CloudMigrate Pro server listening on :${port}`);
});
