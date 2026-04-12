#!/usr/bin/env node
// 截图生成脚本
// 用法: node scripts/generate-screenshots.js

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const screenshots = [
  { html: 'screenshots/screenshot1-connections.html', output: 'screenshots/screenshot1-connections.png' },
  { html: 'screenshots/screenshot2-terminal.html', output: 'screenshots/screenshot2-terminal.png' },
  { html: 'screenshots/screenshot3-filemanager.html', output: 'screenshots/screenshot3-filemanager.png' },
  { html: 'screenshots/screenshot4-monitor.html', output: 'screenshots/screenshot4-monitor.png' },
];

async function generateScreenshot(htmlPath, outputPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  
  const htmlFilePath = path.resolve(rootDir, htmlPath);
  await page.goto(`file://${htmlFilePath}`);
  
  // 等待渲染完成
  await page.waitForTimeout(500);
  
  await page.screenshot({ path: path.resolve(rootDir, outputPath), fullPage: false });
  console.log(`✅ 已生成: ${outputPath}`);
  
  await browser.close();
}

async function main() {
  console.log('📸 开始生成截图...\n');
  
  for (const { html, output } of screenshots) {
    if (!fs.existsSync(path.resolve(rootDir, html))) {
      console.error(`❌ HTML 文件不存在: ${html}`);
      continue;
    }
    
    try {
      await generateScreenshot(html, output);
    } catch (error) {
      console.error(`❌ 截图失败: ${html}`, error.message);
    }
  }
  
  console.log('\n🎉 截图生成完成！');
}

main().catch(console.error);
