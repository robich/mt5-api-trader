#!/usr/bin/env node

/**
 * Telegram Authentication Setup Script
 * Generates a session string for the Telegram channel listener.
 *
 * Usage: npm run telegram:auth
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('=== Telegram Channel Listener - Authentication Setup ===\n');

  const apiId = await ask('Enter your API ID (from https://my.telegram.org): ');
  const apiHash = await ask('Enter your API Hash: ');

  if (!apiId || !apiHash) {
    console.error('API ID and API Hash are required.');
    process.exit(1);
  }

  const session = new StringSession('');
  const client = new TelegramClient(session, parseInt(apiId), apiHash, {
    connectionRetries: 3,
  });

  console.log('\nConnecting to Telegram...');

  await client.start({
    phoneNumber: async () => await ask('Enter your phone number (with country code, e.g. +33...): '),
    phoneCode: async () => await ask('Enter the code you received: '),
    password: async () => await ask('Enter your 2FA password (leave empty if none): '),
    onError: (err) => console.error('Auth error:', err),
  });

  console.log('\n--- Authentication successful! ---\n');

  // Save session string
  const sessionString = client.session.save();
  console.log('Your session string (add to .env as TELEGRAM_SESSION_STRING):');
  console.log(`\nTELEGRAM_SESSION_STRING=${sessionString}\n`);

  // List channels
  console.log('--- Your channels/groups ---\n');

  const dialogs = await client.getDialogs({});
  const channels = dialogs.filter(
    (d) => d.isChannel || d.isGroup
  );

  for (const ch of channels.slice(0, 30)) {
    const id = ch.id?.toString() || 'N/A';
    const title = ch.title || ch.name || 'Unknown';
    console.log(`  ID: ${id}  |  ${title}`);
  }

  console.log('\nAdd the channel ID to .env as TELEGRAM_CHANNEL_ID');
  console.log('(Use the numeric ID from the list above)\n');

  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});
