import type { Core } from '@strapi/strapi';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const oidcClient = strapi
    .plugin('oidc-sso')
    .service('oidc-client') as { init: () => Promise<void> };

  try {
    await oidcClient.init();
    strapi.log.info('[oidc-sso] OIDC client initialised.');
  } catch (err) {
    strapi.log.error(
      `[oidc-sso] failed to initialise OIDC client: ${(err as Error).message}`
    );
    throw err;
  }
};

export default bootstrap;
