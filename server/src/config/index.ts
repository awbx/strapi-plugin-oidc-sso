import { z } from 'zod';
import type { PluginConfig } from '../types';

const endpointsSchema = z
  .object({
    authorization: z.string().url().optional(),
    token: z.string().url().optional(),
    userinfo: z.string().url().optional(),
    jwks: z.string().url().optional(),
    endSession: z.string().url().optional(),
  })
  .partial()
  .optional();

const configSchema = z
  .object({
    issuer: z.string().url().optional(),
    endpoints: endpointsSchema,
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).min(1),
    userMapping: z
      .any()
      .refine((v) => typeof v === 'function', {
        message:
          'userMapping must be a function (claims, ctx) => ({ email, firstName?, lastName? })',
      }),
    autoCreateUsers: z.boolean(),
    defaultRoles: z.array(z.string()),
    allowedDomains: z.array(z.string()),
    useUserinfo: z.boolean(),
    buttonLabel: z.string().min(1),
    buttonIcon: z.string().optional(),
    buttonStyle: z
      .object({
        background: z.string().optional(),
        color: z.string().optional(),
        borderColor: z.string().optional(),
        hoverBackground: z.string().optional(),
        hoverColor: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .refine(
    (cfg) => {
      const e = cfg.endpoints ?? {};
      const haveCoreEndpoints = !!(e.authorization && e.token && e.jwks);
      return !!cfg.issuer || haveCoreEndpoints;
    },
    {
      message:
        'Provide either `issuer` (for OIDC discovery) or all of endpoints.{authorization, token, jwks}.',
    }
  );

const defaults: Partial<PluginConfig> = {
  scopes: ['openid', 'profile', 'email'],
  autoCreateUsers: false,
  defaultRoles: [],
  allowedDomains: [],
  useUserinfo: false,
  buttonLabel: 'Login with SSO',
};

export default {
  default: defaults,
  validator(config: unknown): asserts config is PluginConfig {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      const messages = parsed.error.errors
        .map((e) => `  - ${e.path.join('.') || '<root>'}: ${e.message}`)
        .join('\n');
      throw new Error(
        `[strapi-plugin-oidc-sso] invalid plugin config:\n${messages}`
      );
    }
  },
};
