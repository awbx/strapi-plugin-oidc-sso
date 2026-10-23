import type { Core } from '@strapi/strapi';
import type { PluginConfig } from './types';

const TENANT_PLACEHOLDER = '{tenantid}';

let tenantWarningLogged = false;

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const cfg = strapi.config.get('plugin::oidc-sso') as PluginConfig;

  // Multi-tenant endpoints accept any tenant that exists in the IdP; without an
  // allow-list, any tenant can claim an admin account on this instance.
  if (
    !tenantWarningLogged &&
    cfg.issuer?.includes(TENANT_PLACEHOLDER) &&
    !(cfg.allowedTenantIds && cfg.allowedTenantIds.length > 0)
  ) {
    tenantWarningLogged = true;
    strapi.log.warn(
      '[oidc-sso] multi-tenant issuer configured without `allowedTenantIds` — every tenant of the IdP is accepted. Set `allowedTenantIds` to restrict sign-in to known tenants.'
    );
  }

  const oidcClient = strapi
    .plugin('oidc-sso')
    .service('oidc-client') as { init: () => Promise<void> };

  try {
    await oidcClient.init();
    strapi.log.info('[oidc-sso] OIDC client initialised.');
  } catch (err) {
    // The IdP being down must not prevent Strapi from starting; the client is
    // initialised lazily on the first sign-in attempt instead.
    strapi.log.error(
      `[oidc-sso] failed to initialise OIDC client: ${(err as Error).message}`
    );
  }
};

export default bootstrap;
