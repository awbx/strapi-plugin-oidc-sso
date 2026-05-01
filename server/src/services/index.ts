import oidcClient from './oidc-client';
import stateCookie from './state-cookie';
import userMapper from './user-mapper';
import session from './session';

const services: Record<string, unknown> = {
  'oidc-client': oidcClient,
  'state-cookie': stateCookie,
  'user-mapper': userMapper,
  session,
};

export default services;
