import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables before running tests
config({ path: resolve(__dirname, 'test.env') });
