import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const env = dotenv.config({ path: '.env.local' }).parsed || {};

console.log('URL:', env.NEXT_PUBLIC_SUPABASE_URL);
console.log('ANON key prefix:', String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').slice(0, 30));

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

try {
  const result = await supabase.auth.signUp({
    email: 'test.user@example.com',
    password: 'StrongPass123!',
    options: {
      data: { full_name: 'Test User' },
      emailRedirectTo: 'http://localhost:3000/auth/callback?next=%2Fdashboard'
    }
  });
  
  console.log('\nRESULT:');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('\nERROR:');
  console.error(err.message || err);
  process.exit(1);
}
