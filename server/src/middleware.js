import { getEnv } from './env.js';
import { verifySessionToken } from './auth.js';

export function requireAuth(req, res, next) {
  const env = getEnv();
  const token = req.cookies?.[env.COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  try {
    const session = verifySessionToken(token);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    req.auth = session;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
