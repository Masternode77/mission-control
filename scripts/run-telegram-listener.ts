import path from 'path';
import dotenv from 'dotenv';
import { startTelegramPollingListener } from '../src/lib/telegram-listener';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

dotenv.config();

startTelegramPollingListener().catch((err) => {
  console.error('[telegram-listener] fatal:', err);
  process.exit(1);
});
