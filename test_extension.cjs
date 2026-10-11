const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const extensionPath = path.join(__dirname, 'dist');
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  // Get extension background page target
  const dummyPage = await browser.newPage();
  const targets = await browser.targets();
  const extensionTarget = targets.find(target => target.type() === 'service_worker');
  
  if (!extensionTarget) {
    console.log("No service worker found. Trying to find extension ID from background page.");
  }
  
  const extTargets = targets.filter(t => t.url().startsWith('chrome-extension://'));
  if (extTargets.length === 0) {
     console.log("No extension targets found.");
     await browser.close();
     return;
  }
  
  const extUrl = extTargets[0].url();
  const extId = extUrl.split('/')[2];
  console.log("Extension ID:", extId);
  
  const sidepanelPage = await browser.newPage();
  sidepanelPage.on('console', msg => console.log('SIDEPANEL LOG:', msg.text()));
  sidepanelPage.on('pageerror', err => console.log('SIDEPANEL ERROR:', err.message));
  
  await sidepanelPage.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
  
  // Wait a bit to let it initialize
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
})();
