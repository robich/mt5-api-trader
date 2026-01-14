import { chromium } from 'playwright';

async function testBacktestSymbols() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3002/backtest');
    await page.waitForResponse(r => r.url().includes('/api/symbols'), { timeout: 60000 });
    await page.waitForSelector('input[type="checkbox"][id^="sym-"]', { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Check selected symbols
    const checked = await page.$$eval(
      '.border.rounded-md.p-3 input[type="checkbox"]:checked',
      cbs => cbs.map(cb => cb.nextElementSibling?.textContent?.trim())
    );

    console.log('\n=== Selected by Default ===');
    checked.forEach((s, i) => console.log(`${i + 1}. ${s}`));

    // Check estimation display
    const estimationText = await page.$eval(
      '.bg-secondary\\/50',
      el => el.textContent
    ).catch(() => null);

    console.log('\n=== Estimation Panel ===');
    if (estimationText) {
      console.log('Estimation found: ✓');
      console.log(estimationText);
    } else {
      console.log('Estimation not found: ✗');
    }

    await page.screenshot({ path: 'backtest-symbols-test.png' });
    console.log('\nScreenshot saved');
    await page.waitForTimeout(3000);
  } finally {
    await browser.close();
  }
}

testBacktestSymbols();
