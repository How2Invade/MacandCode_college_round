const puppeteer = require('puppeteer');
const path = require('path');

async function testSites() {
  const extensionPath = path.resolve(__dirname, 'dist');
  console.log('Loading extension from', extensionPath);

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const sites = [
    { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
    { name: 'Google', url: 'https://www.google.com/' },
    { name: 'YouTube', url: 'https://www.youtube.com/' },
    { name: 'GitHub', url: 'https://github.com/' }
  ];

  for (const site of sites) {
    console.log(`\nTesting ${site.name} (${site.url})...`);
    const page = await browser.newPage();
    try {
      await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait a moment for extension content script to inject
      await new Promise(r => setTimeout(r, 1000));
      
      const hasHost = await page.evaluate(() => {
        const host = document.getElementById('handsfree-cursor-host');
        if (!host) return false;
        
        // We simulate the message to make it visible
        const shadow = host.shadowRoot;
        if (!shadow) return 'NO_SHADOW';
        return true;
      });

      console.log(`- Overlay created: ${hasHost}`);
      
      if (hasHost === true) {
         // check body transform
         const bodyStyles = await page.evaluate(() => {
            const style = window.getComputedStyle(document.body);
            return {
              transform: style.transform,
              overflow: style.overflow,
              height: style.height,
              position: style.position,
              contain: style.contain
            };
         });
         console.log('- Body CSS:', bodyStyles);
      }
    } catch (err) {
      console.log(`- Error: ${err.message}`);
    }
    await page.close();
  }
  
  await browser.close();
}

testSites().catch(console.error);
