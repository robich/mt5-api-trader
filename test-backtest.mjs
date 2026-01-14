import { chromium } from 'playwright';

async function testBacktestPairs() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n========================================');
  console.log('  BACKTEST PAIRS TEST');
  console.log('========================================\n');

  console.log('1. Navigating to backtest page...');
  await page.goto('http://localhost:3000/backtest');
  await page.waitForLoadState('networkidle');
  console.log('   Page loaded successfully\n');

  // Wait for symbols to load
  try {
    await page.waitForSelector('text=Loading symbols...', { state: 'hidden', timeout: 10000 });
  } catch (e) {
    // Symbols may already be loaded
  }

  // Get all available symbols
  console.log('2. Checking available symbols...');
  const symbolCheckboxes = await page.locator('input[type="checkbox"][id^="sym-"]').all();
  const allSymbols = [];
  for (const checkbox of symbolCheckboxes) {
    const id = await checkbox.getAttribute('id');
    allSymbols.push(id.replace('sym-', ''));
  }
  console.log(`   Found ${allSymbols.length} available symbols`);
  console.log(`   First 10: ${allSymbols.slice(0, 10).join(', ')}\n`);

  // Get currently selected symbols
  console.log('3. Checking pre-selected symbols...');
  const checkedSymbols = [];
  for (const checkbox of symbolCheckboxes) {
    const isChecked = await checkbox.isChecked();
    if (isChecked) {
      const id = await checkbox.getAttribute('id');
      checkedSymbols.push(id.replace('sym-', ''));
    }
  }
  console.log(`   Pre-selected: ${checkedSymbols.join(', ') || 'None'}\n`);

  // Test selecting multiple pairs
  console.log('4. Testing multi-pair selection...');

  // First, uncheck all
  for (const checkbox of symbolCheckboxes) {
    if (await checkbox.isChecked()) {
      await checkbox.click();
    }
  }
  console.log('   Cleared all selections');

  // Select first 3 symbols for testing
  const testSymbols = allSymbols.slice(0, 3);
  for (const sym of testSymbols) {
    await page.locator(`#sym-${sym}`).click();
  }
  console.log(`   Selected test symbols: ${testSymbols.join(', ')}`);

  // Verify selection badges appear
  await page.waitForTimeout(500);
  const badgesAfter = await page.locator('.flex.flex-wrap.gap-1.mt-2 span').allTextContents();
  console.log(`   Badge display: ${badgesAfter.join(', ')}\n`);

  // Check button state updates
  console.log('5. Verifying button state...');
  const runButton = page.locator('button:has-text("Run Backtest")');
  const isDisabled = await runButton.isDisabled();
  console.log(`   Run button enabled: ${!isDisabled}\n`);

  // Test deselecting all and checking button
  console.log('6. Testing empty selection state...');
  for (const sym of testSymbols) {
    await page.locator(`#sym-${sym}`).click();
  }
  await page.waitForTimeout(300);
  const isDisabledAfterClear = await runButton.isDisabled();
  console.log(`   Button disabled when no symbols: ${isDisabledAfterClear}\n`);

  // Re-select for final test
  console.log('7. Setting up for backtest...');
  for (const sym of testSymbols.slice(0, 2)) {
    await page.locator(`#sym-${sym}`).click();
  }
  console.log(`   Selected: ${testSymbols.slice(0, 2).join(', ')}`);

  // Check date range
  const startDate = await page.locator('#startDate').inputValue();
  const endDate = await page.locator('#endDate').inputValue();
  console.log(`   Date range: ${startDate} to ${endDate}`);

  // Check balance and risk
  const balance = await page.locator('#balance').inputValue();
  const risk = await page.locator('#risk').inputValue();
  console.log(`   Balance: $${balance}, Risk: ${risk}%\n`);

  // Take screenshot before test
  await page.screenshot({ path: 'backtest-pairs-test.png', fullPage: true });
  console.log('8. Screenshot saved: backtest-pairs-test.png\n');

  // Summary
  console.log('========================================');
  console.log('  TEST RESULTS');
  console.log('========================================');
  console.log(`  Page Load:           PASS`);
  console.log(`  Symbols Fetch:       ${allSymbols.length > 0 ? 'PASS' : 'FAIL'} (${allSymbols.length} symbols)`);
  console.log(`  Multi-Select:        ${badgesAfter.length === testSymbols.length ? 'PASS' : 'FAIL'}`);
  console.log(`  Button State:        ${!isDisabled && isDisabledAfterClear ? 'PASS' : 'FAIL'}`);
  console.log(`  Date Auto-Set:       ${startDate && endDate ? 'PASS' : 'FAIL'}`);
  console.log('========================================\n');

  console.log('Browser closing in 3 seconds...');
  await page.waitForTimeout(3000);

  await browser.close();
  console.log('Test completed!\n');
}

testBacktestPairs().catch(console.error);
