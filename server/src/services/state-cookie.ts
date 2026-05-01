import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'koa';
import type { Core } from '@strapi/strapi';

const COOKIE_NAME = 'oidc_sso_state';
const TTL_SECONDS = 600;

type StatePayload = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

const getKey = (strapi: Core.Strapi): Uint8Array => {
  const secret =
    (strapi.config.get('admin.auth.secret') as string | undefined) ??
    (strapi.config.get('admin.auth.options.secret') as string | undefined) ??
    process.env.ADMIN_JWT_SECRET ??
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      '[oidc-sso] cannot sign state cookie: admin JWT secret not configured'
    );
  }
  return new TextEncoder().encode(secret);
};

type StateCookieService = {
  set: (ctx: Context, payload: StatePayload) => Promise<void>;
  consume: (ctx: Context) => Promise<StatePayload | null>;
};

export default ({ strapi }: { strapi: Core.Strapi }): StateCookieService => ({
  async set(ctx, payload) {
    const token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${TTL_SECONDS}s`)
      .sign(getKey(strapi));

    ctx.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.secure,
      maxAge: TTL_SECONDS * 1000,
      overwrite: true,
      path: '/',
    });
  },

  async consume(ctx) {
    const raw = ctx.cookies.get(COOKIE_NAME);
    ctx.cookies.set(COOKIE_NAME, null, { path: '/' });
    if (!raw) return null;
    try {
      const { payload } = await jwtVerify(raw, getKey(strapi));
      const { state, nonce, codeVerifier } = payload as Record<string, unknown>;
      if (
        typeof state !== 'string' ||
        typeof nonce !== 'string' ||
        typeof codeVerifier !== 'string'
      ) {
        return null;
      }
      return { state, nonce, codeVerifier };
    } catch {
      return null;
    }
  },
});
