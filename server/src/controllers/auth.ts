import { randomBytes } from 'node:crypto';
import type { Context } from 'koa';
import type { Core } from '@strapi/strapi';
import type { Claims, PluginConfig } from '../types';

const ADMIN_LOGIN_PATH = '/admin/auth/login';

const renderHandoffHtml = (jwt: string, nonce: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signing you in…</title>
  <meta name="robots" content="noindex" />
</head>
<body>
  <p>Signing you in…</p>
  <script nonce="${nonce}">
    (function () {
      try {
        var jwt = ${JSON.stringify(jwt)};
        try { window.localStorage.setItem('jwtToken', JSON.stringify(jwt)); } catch (_) {}
        try { window.localStorage.setItem('isLoggedIn', 'true'); } catch (_) {}
        try { window.sessionStorage.setItem('jwtToken', JSON.stringify(jwt)); } catch (_) {}
        document.cookie = 'jwtToken=' + encodeURIComponent(jwt) + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
        window.location.replace('/admin');
      } catch (e) {
        window.location.replace('/admin/auth/login?error=oidc');
      }
    })();
  </script>
</body>
</html>`;

const sendError = (ctx: Context, code: string) => {
  ctx.redirect(`${ADMIN_LOGIN_PATH}?oidc_error=${encodeURIComponent(code)}`);
};

const sendHandoff = (ctx: Context, jwt: string) => {
  const nonce = randomBytes(16).toString('base64');
  ctx.status = 200;
  ctx.type = 'text/html; charset=utf-8';
  ctx.set('Cache-Control', 'no-store');
  ctx.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; base-uri 'self'; frame-ancestors 'none'`
  );
  ctx.body = renderHandoffHtml(jwt, nonce);
};

const getCode = (err: unknown): string =>
  (err as { code?: string }).code ?? 'INVALID_OIDC_FLOW';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const mergeClaims = (idTokenClaims: Claims, userinfoClaims?: Claims): Claims =>
  userinfoClaims ? { ...idTokenClaims, ...userinfoClaims } : idTokenClaims;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  uiConfig(ctx: Context) {
    const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;
    ctx.set('Cache-Control', 'no-store');
    ctx.body = {
      label: cfg.buttonLabel,
      icon: cfg.buttonIcon ?? null,
      style: cfg.buttonStyle ?? null,
    };
  },

  async login(ctx: Context) {
    try {
      const oidc = strapi.plugin('oidc-sso').service('oidc-client') as {
        getAuthorizationUrl: () => {
          url: string;
          state: string;
          nonce: string;
          codeVerifier: string;
        };
      };
      const stateCookie = strapi.plugin('oidc-sso').service('state-cookie') as {
        set: (
          ctx: Context,
          payload: { state: string; nonce: string; codeVerifier: string }
        ) => Promise<void>;
      };

      const { url, state, nonce, codeVerifier } = oidc.getAuthorizationUrl();
      await stateCookie.set(ctx, { state, nonce, codeVerifier });
      ctx.redirect(url);
    } catch (err) {
      strapi.log.error(`[oidc-sso] /login failed: ${(err as Error).message}`);
      sendError(ctx, 'IDP_UNREACHABLE');
    }
  },

  async callback(ctx: Context) {
    const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;
    const oidc = strapi.plugin('oidc-sso').service('oidc-client') as {
      exchangeCode: (
        params: Record<string, string>,
        flowState: { state: string; nonce: string; codeVerifier: string }
      ) => Promise<{ idToken: string; accessToken?: string; claims: Claims }>;
      userinfo: (accessToken: string) => Promise<Claims>;
    };
    const stateCookie = strapi.plugin('oidc-sso').service('state-cookie') as {
      consume: (ctx: Context) => Promise<{
        state: string;
        nonce: string;
        codeVerifier: string;
      } | null>;
    };
    const userMapper = strapi.plugin('oidc-sso').service('user-mapper') as {
      resolve: (input: {
        claims: Claims;
        idToken: string;
        accessToken?: string;
      }) => Promise<{
        email: string;
        firstName?: string;
        lastName?: string;
        rawClaims: Claims;
      }>;
    };
    const session = strapi.plugin('oidc-sso').service('session') as {
      loginOrCreate: (
        profile: {
          email: string;
          firstName?: string;
          lastName?: string;
          rawClaims: Claims;
        },
        ctx: Context
      ) => Promise<{ jwt: string }>;
    };

    const flow = await stateCookie.consume(ctx);
    if (!flow) {
      sendError(ctx, 'INVALID_OIDC_FLOW');
      return;
    }

    let idToken: string;
    let accessToken: string | undefined;
    let claims: Claims;

    try {
      const params: Record<string, string> = {};
      if (isObject(ctx.query)) {
        for (const [k, v] of Object.entries(ctx.query)) {
          if (typeof v === 'string') params[k] = v;
        }
      }
      const result = await oidc.exchangeCode(params, flow);
      idToken = result.idToken;
      accessToken = result.accessToken;
      claims = result.claims;

      if (cfg.useUserinfo && accessToken) {
        const ui = await oidc.userinfo(accessToken);
        claims = mergeClaims(claims, ui);
      }
    } catch (err) {
      strapi.log.warn(
        `[oidc-sso] token exchange failed: ${(err as Error).message}`
      );
      sendError(ctx, 'INVALID_OIDC_FLOW');
      return;
    }

    let profile: Awaited<ReturnType<typeof userMapper.resolve>>;
    try {
      profile = await userMapper.resolve({ claims, idToken, accessToken });
    } catch (err) {
      const code =
        getCode(err) === 'DOMAIN_NOT_ALLOWED' ? 'DOMAIN_NOT_ALLOWED' : 'MAPPING_REJECTED';
      strapi.log.warn(`[oidc-sso] user-mapping rejected: ${(err as Error).message}`);
      sendError(ctx, code);
      return;
    }

    let jwt: string;
    try {
      ({ jwt } = await session.loginOrCreate(profile, ctx));
    } catch (err) {
      const code = getCode(err);
      strapi.log.warn(`[oidc-sso] session refused: ${(err as Error).message}`);
      sendError(
        ctx,
        [
          'USER_NOT_PROVISIONED',
          'USER_DISABLED',
          'ROLES_NOT_FOUND',
          'SESSION_MANAGER_UNAVAILABLE',
          'ACCESS_TOKEN_FAILED',
        ].includes(code)
          ? code
          : 'INVALID_OIDC_FLOW'
      );
      return;
    }

    sendHandoff(ctx, jwt);
  },
});
