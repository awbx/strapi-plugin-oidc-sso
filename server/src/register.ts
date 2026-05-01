import type { Core } from '@strapi/strapi';

const register = (_args: { strapi: Core.Strapi }) => {
  // No-op for now. Plugin config is validated by the SDK before this hook runs.
};

export default register;
