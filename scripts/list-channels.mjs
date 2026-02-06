import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const session = new StringSession(process.env.TELEGRAM_SESSION_STRING);

const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });

await client.connect();
console.log('Connected!\n');

const dialogs = await client.getDialogs({});
const channels = dialogs.filter(d => d.isChannel || d.isGroup);

console.log('=== Your channels & groups ===\n');
for (const ch of channels) {
  const id = ch.id?.toString() || 'N/A';
  const title = ch.title || ch.name || 'Unknown';
  console.log(`  ID: ${id.padEnd(16)} | ${title}`);
}

await client.disconnect();
