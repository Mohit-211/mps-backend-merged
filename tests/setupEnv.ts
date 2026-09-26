import path from 'path';

// Tests load the committed placeholder environment (.env.example), never a developer's .env,
// so they are deterministic and can never pick up a real key or database.
process.env.ENV_FILE = path.resolve(__dirname, '../.env.example');
process.env.NODE_ENV = 'test';
delete process.env.GOOGLE_PLACE_API_KEY;
// Throwaway key so token-encryption code paths run in tests (never a real key).
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
