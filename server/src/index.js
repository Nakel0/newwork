import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import PDFDocument from 'pdfkit';
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

function getPlanLimits(plan) {
  // -1 means unlimited
  if (plan === 'starter') return { maxServers: 20, maxPlans: 3, maxReportsPerMonth: 5 };
  if (plan === 'pro') return { maxServers: 100, maxPlans: -1, maxReportsPerMonth: -1 };
  if (plan === 'enterprise') return { maxServers: -1, maxPlans: -1, maxReportsPerMonth: -1 };
  return { maxServers: 5, maxPlans: 1, maxReportsPerMonth: 1 }; // free (default)
}

function isUnderLimit(limit, currentValue) {
  if (limit === -1) return true;
  return currentValue < limit;
}

function isWithinLimit(limit, value) {
  if (limit === -1) return true;
  return value <= limit;
}

function isHexColor(value) {
  return typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value);
}

function safePrimaryColor(value) {
  return isHexColor(value) ? value : '#667eea';
}

function parseDataUrlImage(dataUrl) {
  // Supports: data:image/png;base64,....
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    const buf = Buffer.from(b64, 'base64');
    return { mime, buf };
  } catch {
    return null;
  }
}

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
  data: z.record(z.any())
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

  // Server-enforced usage (do not trust client)
  const ym = getYearMonth();
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  const plan = subscription?.plan || 'free';
  const limits = getPlanLimits(plan);

  const a = (input.data && typeof input.data === 'object' ? input.data.assessment : null) || {};
  const p = (input.data && typeof input.data === 'object' ? input.data.planning : null) || {};

  const physical = Number.isFinite(a?.physicalServers) ? Number(a.physicalServers) : 0;
  const virtual = Number.isFinite(a?.virtualMachines) ? Number(a.virtualMachines) : 0;
  const servers = Math.max(0, Math.trunc(physical) + Math.trunc(virtual));

  const hasPlan = !!(p && typeof p === 'object' && p.cloudProvider && p.migrationStrategy);
  const plans = hasPlan ? 1 : 0;

  if (!isWithinLimit(limits.maxServers, servers)) {
    return res.status(403).json({ error: 'limit_servers', limit: limits.maxServers });
  }
  if (!isWithinLimit(limits.maxPlans, plans)) {
    return res.status(403).json({ error: 'limit_plans', limit: limits.maxPlans });
  }

  await prisma.usageMonth.upsert({
    where: { userId_yearMonth: { userId, yearMonth: ym } },
    create: { userId, yearMonth: ym, servers, plans, reportsThisMonth: 0 },
    update: { servers, plans }
  });

  return res.json({ ok: true });
});

// Server-enforced report usage counter (increment)
app.post('/api/usage/report', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const { userId } = req.auth;

  const ym = getYearMonth();

  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  const plan = subscription?.plan || 'free';
  const limits = getPlanLimits(plan);

  const usage = await prisma.usageMonth.upsert({
    where: { userId_yearMonth: { userId, yearMonth: ym } },
    create: { userId, yearMonth: ym, servers: 0, plans: 0, reportsThisMonth: 0 },
    update: {}
  });

  if (!isUnderLimit(limits.maxReportsPerMonth, usage.reportsThisMonth)) {
    return res.status(403).json({ error: 'limit_reports', limit: limits.maxReportsPerMonth });
  }

  const updated = await prisma.usageMonth.update({
    where: { userId_yearMonth: { userId, yearMonth: ym } },
    data: {
      reportsThisMonth: { increment: 1 },
      lastReportAt: new Date()
    }
  });

  return res.json({
    usage: {
      yearMonth: updated.yearMonth,
      servers: updated.servers,
      plans: updated.plans,
      reportsThisMonth: updated.reportsThisMonth,
      lastReportAt: updated.lastReportAt
    }
  });
});

// -------------------------
// MSP: Organizations / Clients / Projects / Proposals
// -------------------------
async function requireOrgMember(prisma, { userId, organizationId }) {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: true }
  });
  if (!membership) return null;
  return membership;
}

function requireOrgRole(membership, allowedRoles) {
  if (!membership) return false;
  return allowedRoles.includes(membership.role);
}

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(100).optional(),
  brandName: z.string().min(1).max(200).optional(),
  brandPrimaryColor: z.string().optional(),
  brandLogoDataUrl: z.string().optional(),
  brandWebsite: z.string().url().optional(),
  brandEmail: z.string().email().optional()
});

app.get('/api/msp/orgs', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const orgs = await prisma.organizationMember.findMany({
    where: { userId: req.auth.userId },
    include: { organization: true },
    orderBy: { createdAt: 'desc' }
  });
  return res.json({
    organizations: orgs.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      brandName: m.organization.brandName,
      brandPrimaryColor: m.organization.brandPrimaryColor,
      brandWebsite: m.organization.brandWebsite,
      brandEmail: m.organization.brandEmail
    }))
  });
});

app.post('/api/msp/orgs', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  let input;
  try {
    input = CreateOrgSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const org = await prisma.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      brandName: input.brandName,
      brandPrimaryColor: safePrimaryColor(input.brandPrimaryColor),
      brandLogoDataUrl: input.brandLogoDataUrl,
      brandWebsite: input.brandWebsite,
      brandEmail: input.brandEmail,
      members: { create: { userId: req.auth.userId, role: 'owner' } }
    }
  });

  return res.json({ organization: org });
});

const UpdateBrandingSchema = z.object({
  brandName: z.string().min(1).max(200).nullable().optional(),
  brandPrimaryColor: z.string().nullable().optional(),
  brandLogoDataUrl: z.string().nullable().optional(),
  brandWebsite: z.string().url().nullable().optional(),
  brandEmail: z.string().email().nullable().optional()
});

app.put('/api/msp/orgs/:orgId/branding', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const organizationId = req.params.orgId;
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });
  if (!requireOrgRole(membership, ['owner', 'admin'])) return res.status(403).json({ error: 'forbidden' });

  let input;
  try {
    input = UpdateBrandingSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      brandName: input.brandName ?? undefined,
      brandPrimaryColor:
        input.brandPrimaryColor === null ? null : input.brandPrimaryColor ? safePrimaryColor(input.brandPrimaryColor) : undefined,
      brandLogoDataUrl: input.brandLogoDataUrl ?? undefined,
      brandWebsite: input.brandWebsite ?? undefined,
      brandEmail: input.brandEmail ?? undefined
    }
  });

  return res.json({ organization: updated });
});

const CreateClientSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200),
  industry: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().optional()
});

app.get('/api/msp/clients', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const organizationId = String(req.query.organizationId || '');
  if (!organizationId) return res.status(400).json({ error: 'invalid_request' });
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const clients = await prisma.client.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' }
  });
  return res.json({ clients });
});

app.post('/api/msp/clients', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  let input;
  try {
    input = CreateClientSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: input.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const client = await prisma.client.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      industry: input.industry,
      contactEmail: input.contactEmail
    }
  });
  return res.json({ client });
});

const CreateProjectSchema = z.object({
  organizationId: z.string().min(1),
  clientId: z.string().min(1),
  name: z.string().min(1).max(200),
  status: z.enum(['lead', 'qualified', 'proposed', 'in_progress', 'done']).optional(),
  intake: z.record(z.any()).optional()
});

app.get('/api/msp/projects', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const organizationId = String(req.query.organizationId || '');
  const clientId = String(req.query.clientId || '');
  if (!organizationId && !clientId) return res.status(400).json({ error: 'invalid_request' });

  if (organizationId) {
    const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId });
    if (!membership) return res.status(404).json({ error: 'not_found' });
    const projects = await prisma.project.findMany({
      where: { organizationId },
      include: { client: true },
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ projects });
  }

  // clientId path: ensure membership via the client's org
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } });
  if (!client) return res.status(404).json({ error: 'not_found' });
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: client.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const projects = await prisma.project.findMany({
    where: { clientId },
    include: { client: true },
    orderBy: { createdAt: 'desc' }
  });
  return res.json({ projects });
});

app.post('/api/msp/projects', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  let input;
  try {
    input = CreateProjectSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: input.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  // Ensure client belongs to org
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client || client.organizationId !== input.organizationId) return res.status(400).json({ error: 'invalid_request' });

  const project = await prisma.project.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      name: input.name,
      status: input.status,
      intake: input.intake ?? {}
    },
    include: { client: true }
  });
  return res.json({ project });
});

const CreateProposalSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  data: z.record(z.any()).optional()
});

app.get('/api/msp/proposals', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const projectId = String(req.query.projectId || '');
  if (!projectId) return res.status(400).json({ error: 'invalid_request' });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) return res.status(404).json({ error: 'not_found' });
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: project.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const proposals = await prisma.proposal.findMany({
    where: { projectId },
    orderBy: [{ version: 'desc' }]
  });
  return res.json({ proposals });
});

app.post('/api/msp/proposals', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  let input;
  try {
    input = CreateProposalSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: input.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project || project.organizationId !== input.organizationId) return res.status(400).json({ error: 'invalid_request' });

  const last = await prisma.proposal.findFirst({
    where: { projectId: input.projectId },
    orderBy: { version: 'desc' },
    select: { version: true }
  });
  const nextVersion = (last?.version || 0) + 1;

  const proposal = await prisma.proposal.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      version: nextVersion,
      title: input.title,
      status: 'draft',
      sentAt: null,
      data: input.data ?? {}
    }
  });
  return res.json({ proposal });
});

const CreateProposalVersionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  data: z.record(z.any()).optional()
});

// Edit by saving a new version (v2, v3...) from an existing proposal
app.post('/api/msp/proposals/:proposalId/versions', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const proposalId = req.params.proposalId;

  let input;
  try {
    input = CreateProposalVersionSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const base = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!base) return res.status(404).json({ error: 'not_found' });

  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: base.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const last = await prisma.proposal.findFirst({
    where: { projectId: base.projectId },
    orderBy: { version: 'desc' },
    select: { version: true }
  });
  const nextVersion = (last?.version || 0) + 1;

  const created = await prisma.proposal.create({
    data: {
      organizationId: base.organizationId,
      projectId: base.projectId,
      version: nextVersion,
      title: input.title ?? base.title,
      status: 'draft',
      sentAt: null,
      data: input.data ?? (base.data && typeof base.data === 'object' ? base.data : {})
    }
  });

  return res.json({ proposal: created });
});

// Send action (marks proposal as sent + stores sentAt)
app.post('/api/msp/proposals/:proposalId/send', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const proposalId = req.params.proposalId;

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return res.status(404).json({ error: 'not_found' });

  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: proposal.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });
  if (!requireOrgRole(membership, ['owner', 'admin'])) return res.status(403).json({ error: 'forbidden' });

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: {
      status: 'sent',
      sentAt: proposal.sentAt ?? new Date()
    }
  });

  return res.json({ proposal: updated });
});

async function renderProposalPdf({ organization, client, project, proposal }) {
  const brandName = organization.brandName || organization.name;
  const primary = safePrimaryColor(organization.brandPrimaryColor);
  const logo = parseDataUrlImage(organization.brandLogoDataUrl);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const pageWidth = doc.page.width;

  // Header bar
  doc.save();
  doc.rect(0, 0, pageWidth, 90).fill(primary);
  doc.restore();

  // Brand header text / logo
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold');
  doc.text(brandName, 50, 28, { continued: false });

  if (logo) {
    try {
      // Place logo top-right; PDFKit can infer format from buffer in most cases.
      doc.image(logo.buf, pageWidth - 140, 18, { fit: [90, 60] });
    } catch {
      // ignore logo errors
    }
  }

  doc.fontSize(10).font('Helvetica').fillColor('#ffffff');
  const metaParts = [organization.brandWebsite, organization.brandEmail].filter(Boolean);
  if (metaParts.length) doc.text(metaParts.join(' • '), 50, 58);

  doc.fillColor('#111827');
  doc.fontSize(18).font('Helvetica-Bold');
  doc.text(`Proposal: ${proposal.title}`, 50, 120);

  doc.fontSize(11).font('Helvetica');
  doc.text(`Client: ${client.name}`, 50, 150);
  doc.text(`Project: ${project.name}`, 50, 168);
  const sentLine = proposal.sentAt ? ` • Sent: ${new Date(proposal.sentAt).toLocaleDateString()}` : '';
  doc.text(`Version: v${proposal.version} • Status: ${proposal.status}${sentLine}`, 50, 186);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 50, 204);

  let y = 235;

  function section(title) {
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#111827');
    doc.text(title, 50, y);
    y += 16;
    doc.moveTo(50, y).lineTo(pageWidth - 50, y).lineWidth(1).strokeColor('#e5e7eb').stroke();
    y += 12;
    doc.fontSize(11).font('Helvetica').fillColor('#111827');
  }

  function ensureSpace(px) {
    if (y + px < doc.page.height - 60) return;
    doc.addPage();
    y = 60;
  }

  const data = (proposal.data && typeof proposal.data === 'object') ? proposal.data : {};

  // Overview
  const overview = typeof data.overview === 'string' ? data.overview : '';
  if (overview) {
    ensureSpace(120);
    section('Overview');
    doc.text(overview, 50, y, { width: pageWidth - 100 });
    y = doc.y + 18;
  }

  // Scope
  const scope = Array.isArray(data.scope) ? data.scope : [];
  if (scope.length) {
    ensureSpace(160);
    section('Scope of Work');
    for (const item of scope) {
      ensureSpace(40);
      if (typeof item === 'string') {
        doc.text(`• ${item}`, 50, y, { width: pageWidth - 100 });
        y = doc.y + 6;
        continue;
      }
      if (item && typeof item === 'object') {
        const t = typeof item.title === 'string' ? item.title : 'Scope item';
        const d = typeof item.description === 'string' ? item.description : '';
        doc.font('Helvetica-Bold').text(`• ${t}`, 50, y, { width: pageWidth - 100 });
        y = doc.y + 2;
        doc.font('Helvetica');
        if (d) {
          doc.text(d, 70, y, { width: pageWidth - 120 });
          y = doc.y + 6;
        } else {
          y += 6;
        }
      }
    }
    y += 10;
  }

  // Pricing
  const pricing = (data.pricing && typeof data.pricing === 'object') ? data.pricing : null;
  if (pricing) {
    ensureSpace(140);
    section('Pricing');
    const currency = typeof pricing.currency === 'string' ? pricing.currency : '$';
    const oneTime = pricing.oneTime;
    const monthly = pricing.monthly;
    if (typeof oneTime === 'number') doc.text(`One-time project: ${currency}${oneTime.toLocaleString()}`, 50, y);
    y = doc.y + 6;
    if (typeof monthly === 'number') doc.text(`Optional managed services: ${currency}${monthly.toLocaleString()}/month`, 50, y);
    y = doc.y + 14;
    if (typeof pricing.notes === 'string' && pricing.notes) {
      doc.text(pricing.notes, 50, y, { width: pageWidth - 100 });
      y = doc.y + 10;
    }
  }

  // Assumptions
  const assumptions = Array.isArray(data.assumptions) ? data.assumptions : [];
  if (assumptions.length) {
    ensureSpace(140);
    section('Assumptions');
    for (const a of assumptions) {
      ensureSpace(30);
      if (typeof a === 'string') {
        doc.text(`• ${a}`, 50, y, { width: pageWidth - 100 });
        y = doc.y + 6;
      }
    }
    y += 10;
  }

  // Next steps
  const nextSteps = Array.isArray(data.nextSteps) ? data.nextSteps : [];
  if (nextSteps.length) {
    ensureSpace(120);
    section('Next Steps');
    for (const s of nextSteps) {
      ensureSpace(30);
      if (typeof s === 'string') {
        doc.text(`• ${s}`, 50, y, { width: pageWidth - 100 });
        y = doc.y + 6;
      }
    }
    y += 10;
  }

  // Footer
  doc.fontSize(9).fillColor('#6b7280');
  doc.text(`Prepared by ${brandName}`, 50, doc.page.height - 45);

  return await new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

app.get('/api/msp/proposals/:proposalId/pdf', requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const proposalId = req.params.proposalId;

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return res.status(404).json({ error: 'not_found' });

  const membership = await requireOrgMember(prisma, { userId: req.auth.userId, organizationId: proposal.organizationId });
  if (!membership) return res.status(404).json({ error: 'not_found' });

  const [organization, project] = await Promise.all([
    prisma.organization.findUnique({ where: { id: proposal.organizationId } }),
    prisma.project.findUnique({ where: { id: proposal.projectId }, include: { client: true } })
  ]);

  if (!organization || !project) return res.status(404).json({ error: 'not_found' });

  const pdf = await renderProposalPdf({
    organization,
    client: project.client,
    project,
    proposal
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="proposal-v${proposal.version}.pdf"`);
  return res.status(200).send(pdf);
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
