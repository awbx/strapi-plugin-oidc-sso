import * as React from 'react';

type Props = {
  label: string;
  href: string;
};

const styles: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '1rem',
  padding: '0.625rem 1rem',
  textAlign: 'center',
  textDecoration: 'none',
  borderRadius: '4px',
  border: '1px solid #4945FF',
  background: '#fff',
  color: '#4945FF',
  fontWeight: 600,
  fontSize: '0.875rem',
  lineHeight: 1.43,
  cursor: 'pointer',
  boxSizing: 'border-box',
};

const SsoButton: React.FC<Props> = ({ label, href }) => (
  <a href={href} style={styles} data-testid="oidc-sso-login">
    {label}
  </a>
);

export default SsoButton;
