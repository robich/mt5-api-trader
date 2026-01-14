// Test script to find available symbols on your broker
import MetaApi from 'metaapi.cloud-sdk';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.META_API_TOKEN;
const accountId = process.env.META_API_ACCOUNT_ID;

async function findSymbols() {
  console.log('Connecting to MetaAPI...');
  const api = new MetaApi(token);

  const account = await api.metatraderAccountApi.getAccount(accountId);

  if (account.state !== 'DEPLOYED') {
    console.log('Deploying account...');
    await account.deploy();
  }

  await account.waitConnected();

  // Create streaming connection to get symbol list
  console.log('Creating connection to get symbols...');
  const connection = account.getStreamingConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const specs = connection.terminalState.specifications || [];

  // Find gold-related symbols
  console.log('\n=== Gold/XAU symbols ===');
  const goldSymbols = specs.filter(s =>
    s.symbol.toUpperCase().includes('XAU') ||
    s.symbol.toUpperCase().includes('GOLD')
  );
  goldSymbols.forEach(s => console.log(`  ${s.symbol} - ${s.description || ''}`));

  // Find silver-related symbols
  console.log('\n=== Silver/XAG symbols ===');
  const silverSymbols = specs.filter(s =>
    s.symbol.toUpperCase().includes('XAG') ||
    s.symbol.toUpperCase().includes('SILVER')
  );
  silverSymbols.forEach(s => console.log(`  ${s.symbol} - ${s.description || ''}`));

  // Find BTC symbols
  console.log('\n=== BTC symbols ===');
  const btcSymbols = specs.filter(s =>
    s.symbol.toUpperCase().includes('BTC')
  );
  btcSymbols.forEach(s => console.log(`  ${s.symbol} - ${s.description || ''}`));

  // Find major forex pairs
  console.log('\n=== Major Forex pairs ===');
  const majorPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];
  const forexSymbols = specs.filter(s =>
    majorPairs.some(p => s.symbol.toUpperCase().includes(p))
  );
  forexSymbols.forEach(s => console.log(`  ${s.symbol} - ${s.description || ''}`));

  console.log(`\nTotal symbols available: ${specs.length}`);

  // Close connection
  await connection.close();
  console.log('\nDone!');
  process.exit(0);
}

findSymbols().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
