import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateImages() {
  const installerDir = join(__dirname, '../src-tauri/installer');
  
  if (!fs.existsSync(installerDir)) {
    fs.mkdirSync(installerDir, { recursive: true });
  }

  console.log('\n🎨 Generating installer images...\n');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  const htmlPath = join(__dirname, 'generate-installer-images.html');
  await page.goto(`file://${htmlPath}`);

  await page.waitForTimeout(1000);

  const dmgCanvas = await page.locator('#dmg-background');
  await dmgCanvas.screenshot({ 
    path: join(installerDir, 'dmg-background.png'),
    omitBackground: true
  });
  console.log('✓ Created dmg-background.png (1320x800 @2x)');

  const sidebarCanvas = await page.locator('#windows-sidebar');
  await sidebarCanvas.screenshot({ 
    path: join(installerDir, 'installer-sidebar.png'),
    omitBackground: true
  });
  console.log('✓ Created installer-sidebar.png (164x314 @2x)');

  const headerCanvas = await page.locator('#windows-header');
  await headerCanvas.screenshot({ 
    path: join(installerDir, 'installer-header.png'),
    omitBackground: true
  });
  console.log('✓ Created installer-header.png (150x57 @2x)');

  await browser.close();

  console.log('\n✅ All installer images generated successfully!\n');
  console.log('Generated files:');
  console.log('  - src-tauri/installer/dmg-background.png');
  console.log('  - src-tauri/installer/installer-sidebar.png');
  console.log('  - src-tauri/installer/installer-header.png');
  console.log('\nNote: Windows installer requires .bmp files.');
  console.log('You can convert PNG to BMP using: https://convertio.co/png-bmp/');
}

generateImages().catch(console.error);
