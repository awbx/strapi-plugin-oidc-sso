import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import type { Claims, PluginConfig, ResolvedProfile, UserMappingFn } from '../types';

const mappedUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional(),
  groups: z.array(z.string()).optional(),
});

type MapInput = {
  claims: Claims;
  idToken: string;
  accessToken?: string;
};

type UserMapperService = {
  resolve: (input: MapInput) => Promise<ResolvedProfile>;
};

export default ({ strapi }: { strapi: Core.Strapi }): UserMapperService => ({
  async resolve({ claims, idToken, accessToken }) {
    const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;
    const fn: UserMappingFn = cfg.userMapping;

    const raw = await fn(claims, { idToken, accessToken, strapi });
    const parsed = mappedUserSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `[oidc-sso] userMapping returned invalid shape: ${parsed.error.message}`
      );
    }

    const email = parsed.data.email.toLowerCase();

    const allowed = cfg.allowedDomains
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length > 0) {
      const domain = email.split('@')[1] ?? '';
      if (!allowed.includes(domain)) {
        const err = new Error(`domain "${domain}" is not allowed`);
        (err as Error & { code: string }).code = 'DOMAIN_NOT_ALLOWED';
        throw err;
      }
    }

    return { ...parsed.data, email, rawClaims: claims };
  },
});
