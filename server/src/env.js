import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().optional(),

  // Auth
  JWT_SECRET: z.string().min(20),
  COOKIE_NAME: z.string().default('cm_session'),

  // DB
  DATABASE_URL: z.string().min(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PUBLIC_KEY: z.string().min(1).optional(),

  // Stripe Price IDs
  STRIPE_PRICE_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().min(1).optional(),

  // Used for redirect URLs in Stripe flows
  APP_BASE_URL: z.string().url().default('http://localhost:3000')
});

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Throw a readable error at boot time
    const flattened = parsed.error.flatten();
    const details = Object.entries(flattened.fieldErrors)
      .map(([k, v]) => `${k}: ${v?.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return parsed.data;
}
