import os from 'os';
import path from 'path';

// Tests load the committed placeholder environment (.env.example), never a developer's .env,
// so they are deterministic and can never pick up a real key or database.
process.env.ENV_FILE = path.resolve(__dirname, '../.env.example');
process.env.NODE_ENV = 'test';
delete process.env.GOOGLE_PLACE_API_KEY;
// Throwaway key so token-encryption code paths run in tests (never a real key).
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
// Phase 12.5: tests pin one sample and no spacing (the production defaults, 3 samples 60 s apart, are
// checked in tests/configs/config.ranking.test.ts), so call counts in tests stay per single search.
process.env.RANK_SAMPLES_PER_POINT = '1';
process.env.RANK_SAMPLE_SPACING_SEC = '0';
// Phase 12: report PDFs and logos go to a per-worker temporary directory, never into the repo.
process.env.REPORTS_STORAGE_DIR = path.join(os.tmpdir(), `mps-test-reports-${process.pid}`);
