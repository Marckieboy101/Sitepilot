import { signUpAction } from './src/features/auth/actions.ts';

const result = await signUpAction({
  name: 'Test User',
  email: 'test.user@example.com',
  password: 'StrongPass123!',
  acceptTerms: true
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
