import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage() {
  const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS || 'vt.edu';

  return <LoginForm allowedDomains={allowedDomains} />;
}
