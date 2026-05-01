export default [
  {
    method: 'GET',
    path: '/ui-config',
    handler: 'auth.uiConfig',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/login',
    handler: 'auth.login',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/callback',
    handler: 'auth.callback',
    config: {
      auth: false,
      policies: [],
    },
  },
];
