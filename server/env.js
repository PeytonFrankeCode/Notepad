// Loads configuration from a .env file in the project root (if present) before
// anything else reads process.env. Imported first by index.js. Real environment
// variables (e.g. from Docker or a Windows service) still take precedence.
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env') });
