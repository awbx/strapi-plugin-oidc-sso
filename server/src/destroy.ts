import type { Core } from '@strapi/strapi';

const destroy = (_args: { strapi: Core.Strapi }) => {
  // nothing to clean up — OIDC Issuer cache lives in module scope
};

export default destroy;
