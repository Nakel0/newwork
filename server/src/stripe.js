import Stripe from 'stripe';

import { getEnv } from './env.js';

export function getStripe() {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    typescript: false
  });
}

export function planToPriceId(plan) {
  const env = getEnv();
  if (plan === 'starter') return env.STRIPE_PRICE_STARTER;
  if (plan === 'pro') return env.STRIPE_PRICE_PRO;
  if (plan === 'enterprise') return env.STRIPE_PRICE_ENTERPRISE;
  return null;
}

export function priceIdToPlan(priceId) {
  const env = getEnv();
  if (!priceId) return 'free';
  if (env.STRIPE_PRICE_STARTER && priceId === env.STRIPE_PRICE_STARTER) return 'starter';
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (env.STRIPE_PRICE_ENTERPRISE && priceId === env.STRIPE_PRICE_ENTERPRISE) return 'enterprise';
  return null;
}

export function mapStripeStatus(status) {
  // Stripe statuses: incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid, paused
  // Our enum doesn't include paused, map to past_due (conservative) or unpaid.
  if (status === 'paused') return 'past_due';
  return status;
}
