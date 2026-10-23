import { randomUUID } from 'node:crypto';
import generator from 'generate-password';
import type { Context } from 'koa';
import type { Core } from '@strapi/strapi';
import type { PluginConfig, ResolvedProfile } from '../types';
import { getAdminBasePath } from '../utils/admin-path';

const REFRESH_COOKIE_NAME = 'strapi_admin_refresh';

type AdminUser = {
  id: number | string;
  email: string;
  isActive?: boolean;
  blocked?: boolean;
  registrationToken?: string | null;
};

type AdminUserService = {
  findOneByEmail: (email: string) => Promise<AdminUser | null>;
  create: (input: Record<string, unknown>) => Promise<AdminUser>;
  register: (input: {
    registrationToken: string;
    userInfo: Record<string, unknown>;
  }) => Promise<AdminUser>;
};

type AdminRole = { id: number | string; code: string };

type SessionManager = (
  scope: 'admin'
) => {
  generateRefreshToken: (
    userId: string,
    deviceId: string,
    opts: { type: 'refresh' | 'session' }
  ) => Promise<{ token: string; absoluteExpiresAt?: string }>;
  generateAccessToken: (
    refreshToken: string
  ) => Promise<{ token: string } | { error: string }>;
};

type SessionService = {
  loginOrCreate: (
    profile: ResolvedProfile,
    ctx: Context
  ) => Promise<{ user: AdminUser; jwt: string }>;
};

const codedError = (code: string, message?: string) => {
  const err = new Error(message ?? code);
  (err as Error & { code: string }).code = code;
  return err;
};

const lookupRole = async (
  strapi: Core.Strapi,
  code: string
): Promise<AdminRole | null> =>
  (await strapi.db
    .query('admin::role')
    .findOne({ where: { code } })) as AdminRole | null;

const resolveRoleIds = async (
  strapi: Core.Strapi,
  codes: string[]
): Promise<(number | string)[]> => {
  if (codes.length === 0) {
    const fallback = await lookupRole(strapi, 'strapi-author');
    return fallback ? [fallback.id] : [];
  }
  const roles = (await Promise.all(codes.map((c) => lookupRole(strapi, c)))).filter(
    (r): r is AdminRole => r !== null
  );
  if (roles.length === 0) {
    throw codedError(
      'ROLES_NOT_FOUND',
      `none of the configured defaultRoles exist: ${codes.join(', ')}`
    );
  }
  return roles.map((r) => r.id);
};

const generateAccessToken = async (
  strapi: Core.Strapi,
  ctx: Context,
  user: AdminUser
): Promise<string> => {
  const sessionManager = (strapi as unknown as { sessionManager: SessionManager })
    .sessionManager;
  if (!sessionManager) {
    throw codedError(
      'SESSION_MANAGER_UNAVAILABLE',
      'strapi.sessionManager is not available; upgrade Strapi to v5.24.1 or later'
    );
  }
  const userId = String(user.id);
  const deviceId = randomUUID();

  const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;

  const { token: refreshToken } = await sessionManager('admin').generateRefreshToken(
    userId,
    deviceId,
    { type: 'session' }
  );

  ctx.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.secureCookies ?? ctx.secure,
    // Cookie paths are matched by the browser against the URL it requested, so
    // this has to carry the reverse-proxy prefix; scoping it to a bare /admin
    // behind a proxy means the cookie is never sent back and the session
    // cannot be refreshed.
    path: getAdminBasePath(strapi),
    overwrite: true,
  });

  const accessResult = await sessionManager('admin').generateAccessToken(refreshToken);
  if ('error' in accessResult) {
    throw codedError('ACCESS_TOKEN_FAILED', accessResult.error);
  }
  return accessResult.token;
};

export default ({ strapi }: { strapi: Core.Strapi }): SessionService => ({
  async loginOrCreate(profile, ctx) {
    const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;
    const userService = strapi.service('admin::user') as unknown as AdminUserService;

    // An IdP that explicitly says the address is unverified must never be able
    // to create or claim an admin account with it.
    const emailVerified = profile.rawClaims?.email_verified;
    if (emailVerified === false) {
      throw codedError(
        'EMAIL_NOT_VERIFIED',
        'the identity provider reports email_verified=false for this account'
      );
    }
    if (cfg.requireEmailVerified && emailVerified !== true) {
      throw codedError(
        'EMAIL_NOT_VERIFIED',
        'requireEmailVerified is enabled but the identity provider did not confirm email_verified=true'
      );
    }

    let user = await userService.findOneByEmail(profile.email);

    if (!user) {
      if (!cfg.autoCreateUsers) {
        throw codedError('USER_NOT_PROVISIONED');
      }
      const roleIds = await resolveRoleIds(strapi, cfg.defaultRoles);

      const created = await userService.create({
        firstname: profile.firstName ?? profile.email.split('@')[0],
        lastname: profile.lastName ?? '',
        email: profile.email,
        roles: roleIds,
      });

      const password = generator.generate({
        length: 43,
        numbers: true,
        lowercase: true,
        uppercase: true,
        exclude: '()+_-=}{[]|:;"/?.><,`~',
        strict: true,
      });

      user = await userService.register({
        registrationToken: created.registrationToken as string,
        userInfo: {
          firstname: profile.firstName ?? profile.email.split('@')[0],
          lastname: profile.lastName ?? '',
          password,
        },
      });

      strapi.log.info(
        `[oidc-sso] auto-provisioned admin user ${profile.email} with roles ${cfg.defaultRoles.join(', ') || '(default)'}`
      );
    }

    if (user.isActive === false || user.blocked === true) {
      throw codedError('USER_DISABLED');
    }

    const jwt = await generateAccessToken(strapi, ctx, user);
    return { user, jwt };
  },
});
