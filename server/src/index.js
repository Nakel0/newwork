import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { z } from 'zod';

import { parseLogin, parseSignup, createSessionToken, getCookieOptions, hashPassword, verifyPassword } from './auth.js';
import { getPrisma } from './db.js';
import { getEnv } from './env.js';
import { requireAuth } from './middleware.js';
import { getStripe, mapStripeStatus, planToPriceId, priceIdToPlan } from './stripe.js';
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

// Stripe webhook must receive raw body for signature verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const prisma = getPrisma();
  const stripe = getStripe();
  if (!env.STRIPE_WEBHOOK_SECRET) return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET');

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  async function upsertFromStripeSubscription(stripeSub) {
    // Determine plan from price id
    const priceId = stripeSub.items?.data?.[0]?.price?.id || null;
    const plan = priceIdToPlan(priceId) || 'free';
    const status = mapStripeStatus(stripeSub.status);

    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;

    // subscription metadata should carry userId, but if not, locate by stripeSubscriptionId
    const userIdFromMeta = stripeSub.metadata?.userId;

    let userId = userIdFromMeta;
    if (!userId) {
      const existing = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: stripeSub.id },
        select: { userId: true }
      });
      userId = existing?.userId || null;
    }

    if (!userId) return; // Can't associate — ignore (or log)

    // Ensure user has customer id stored
    if (customerId) {
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId }
      }).catch(() => {});
    }

    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        status,
        stripeSubscriptionId: stripeSub.id,
        stripePriceId: priceId,
        currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : null,
        currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
        cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
        trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null
      },
      update: {
        plan,
        status,
        stripeSubscriptionId: stripeSub.id,
        stripePriceId: priceId,
        currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : null,
        currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
        cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
        trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null
      }
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Attach customer/subscription to our user via metadata
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId && typeof customerId === 'string') {
          await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } }).catch(() => {});
        }

        if (typeof subscriptionId === 'string') {
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
          await upsertFromStripeSubscription(stripeSub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        await upsertFromStripeSubscription(stripeSub);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    return res.status(500).send('Webhook handler failed');
  }

  return res.json({ received: true });
});

// JSON parsing for API routes (everything except Stripe webhook)
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
  let subscription = user.subscription;
  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: { userId: user.id, plan: 'free', status: 'active' }
    });
  }

  const token = createSessionToken({ userId: user.id });
  res.cookie(env.COOKIE_NAME, token, getCookieOptions());

  return res.json({
    user: { id: user.id, email: user.email, name: user.name, companyName: user.companyName },
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt
        }
      : null
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(env.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// Update profile (keep email immutable for now)
const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200)
});

app.put('/api/me', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { userId } = req.auth;

  let input;
  try {
    input = UpdateProfileSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, companyName: input.companyName },
    select: { id: true, email: true, name: true, companyName: true }
  });

  return res.json({ user: updated });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { userId } = req.auth;

  // Ensure the current usage row exists
  const ym = getYearMonth();
  await prisma.usageMonth.upsert({
    where: { userId_yearMonth: { userId, yearMonth: ym } },
    create: { userId, yearMonth: ym, servers: 0, plans: 0, reportsThisMonth: 0 },
    update: {}
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      usageMonths: { where: { yearMonth: ym } },
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
      : { yearMonth: ym, servers: 0, plans: 0, reportsThisMonth: 0, lastReportAt: null },
    appState: user.appState?.data ?? {}
  });
});

// Save app state + usage (single endpoint so the client stays simple)
const SaveAppStateSchema = z.object({
  data: z.record(z.any()),
  usage: z
    .object({
      servers: z.number().int().min(0).optional(),
      plans: z.number().int().min(0).optional(),
      reportsThisMonth: z.number().int().min(0).optional(),
      lastReportAt: z.string().datetime().nullable().optional()
    })
    .optional()
});

app.put('/api/app/state', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { userId } = req.auth;

  let input;
  try {
    input = SaveAppStateSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  await prisma.appState.upsert({
    where: { userId },
    create: { userId, data: input.data, version: 1 },
    update: { data: input.data }
  });

  const ym = getYearMonth();
  if (input.usage) {
    await prisma.usageMonth.upsert({
      where: { userId_yearMonth: { userId, yearMonth: ym } },
      create: {
        userId,
        yearMonth: ym,
        servers: input.usage.servers ?? 0,
        plans: input.usage.plans ?? 0,
        reportsThisMonth: input.usage.reportsThisMonth ?? 0,
        lastReportAt: input.usage.lastReportAt ? new Date(input.usage.lastReportAt) : null
      },
      update: {
        servers: input.usage.servers,
        plans: input.usage.plans,
        reportsThisMonth: input.usage.reportsThisMonth,
        lastReportAt: input.usage.lastReportAt ? new Date(input.usage.lastReportAt) : undefined
      }
    });
  }

  return res.json({ ok: true });
});

// -------------------------
// Billing (Stripe)
// -------------------------
const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'enterprise'])
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const stripe = getStripe();

  let input;
  try {
    input = CheckoutSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { subscription: true }
  });
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const priceId = planToPriceId(input.plan);
  if (!priceId) return res.status(500).json({ error: 'missing_stripe_price_id' });

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id }
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const successUrl = `${env.APP_BASE_URL}/index.html#billing?success=1`;
  const cancelUrl = `${env.APP_BASE_URL}/index.html#billing?canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    subscription_data: {
      metadata: { userId: user.id },
      trial_period_days: 14
    },
    metadata: {
      userId: user.id,
      requestedPlan: input.plan
    }
  });

  return res.json({ url: session.url });
});

app.post('/api/billing/portal', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const stripe = getStripe();

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!user.stripeCustomerId) return res.status(400).json({ error: 'no_stripe_customer' });

  const returnUrl = `${env.APP_BASE_URL}/index.html#billing`;

  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl
  });

  return res.json({ url: portal.url });
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
