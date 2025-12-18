# 🚀 Quick Start - Run Locally (Backend + DB)

## Step 1: Configure environment

- Copy `.env.example` → `.env`
- Set:
  - `JWT_SECRET`
  - `DATABASE_URL`
  - Stripe keys + price IDs (optional for Free plan)

## Step 2: Start Postgres

If you have Docker:

```bash
docker compose up -d
```

## Step 3: Install + migrate + run

```bash
npm install

# Prisma CLI reads DATABASE_URL from your shell environment
set -a; source .env; set +a
npm run db:migrate

npm run dev
```

Open: `http://localhost:3000`

## Notes about deployment

This is no longer a “static-only” app. You’ll deploy the **Node server** plus a **Postgres database** (and configure Stripe webhooks) on a platform like Render/Fly/Railway.

---

**Need help?** Check `DEPLOYMENT.md` for detailed instructions.

