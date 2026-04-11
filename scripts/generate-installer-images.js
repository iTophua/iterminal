const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const installerDir = path.join(__dirname, '../src-tauri/installer');
const iconsDir = path.join(__dirname, '../src-tauri/icons');

if (!fs.existsSync(installerDir)) {
  fs.mkdirSync(installerDir, { recursive: true });
}

const colors = {
  primary: '#3B82F6',
  primaryDark: '#1E40AF',
  secondary: '#10B981',
  background: '#0F172A',
  backgroundLight: '#1E293B',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  accent: '#8B5CF6'
};

async function createDMGBackground() {
  const width = 1320;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0F172A');
  gradient.addColorStop(0.5, '#1E293B');
  gradient.addColorStop(1, '#0F172A');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 200 + 100;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.beginPath();
  ctx.arc(width * 0.3, height * 0.5, 300, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(139, 92, 246, 0.05)';
  ctx.beginPath();
  ctx.arc(width * 0.7, height * 0.3, 250, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.text;
  ctx.font = 'bold 72px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('iTerminal', width / 2, 120);

  ctx.fillStyle = colors.textMuted;
  ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('SSH Connection Manager', width / 2, 165);

  const arrowY = height / 2 + 50;
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 10]);
  ctx.beginPath();
  ctx.moveTo(width / 2 - 200, arrowY);
  ctx.lineTo(width / 2 + 200, arrowY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = colors.primary;
  ctx.beginPath();
  ctx.moveTo(width / 2 + 200, arrowY);
  ctx.lineTo(width / 2 + 180, arrowY - 15);
  ctx.lineTo(width / 2 + 180, arrowY + 15);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.textMuted;
  ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Drag to Applications folder to install', width / 2, arrowY + 50);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(installerDir, 'dmg-background.png'), buffer);
  console.log('✓ Created dmg-background.png (1320x800)');
}

async function createWindowsSidebar() {
  const width = 164;
  const height = 314;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1E293B');
  gradient.addColorStop(1, '#0F172A');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
  ctx.beginPath();
  ctx.arc(82, 80, 60, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.text;
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('iTerminal', 82, 160);

  ctx.fillStyle = colors.textMuted;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('SSH Manager', 82, 180);

  ctx.fillStyle = colors.primary;
  ctx.fillRect(20, height - 40, width - 40, 3);

  const buffer = canvas.toBuffer('image/png');
  
  const bmpBuffer = Buffer.alloc(width * height * 4 + 54);
  bmpBuffer.write('BM', 0);
  bmpBuffer.writeUInt32LE(bmpBuffer.length, 2);
  bmpBuffer.writeUInt32LE(54, 10);
  bmpBuffer.writeUInt32LE(40, 14);
  bmpBuffer.writeUInt32LE(width, 18);
  bmpBuffer.writeUInt32LE(height, 22);
  bmpBuffer.writeUInt16LE(1, 26);
  bmpBuffer.writeUInt16LE(32, 28);
  bmpBuffer.writeUInt32LE(width * height * 4, 34);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = ((height - 1 - y) * width + x) * 4;
      const dstIdx = 54 + (y * width + x) * 4;
      bmpBuffer[dstIdx] = buffer[srcIdx];
      bmpBuffer[dstIdx + 1] = buffer[srcIdx + 1];
      bmpBuffer[dstIdx + 2] = buffer[srcIdx + 2];
      bmpBuffer[dstIdx + 3] = buffer[srcIdx + 3];
    }
  }

  fs.writeFileSync(path.join(installerDir, 'installer-sidebar.bmp'), bmpBuffer);
  console.log('✓ Created installer-sidebar.bmp (164x314)');
}

async function createWindowsHeader() {
  const width = 150;
  const height = 57;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#1E293B');
  gradient.addColorStop(1, '#0F172A');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = colors.text;
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('iTerminal', width / 2, height / 2 + 5);

  const buffer = canvas.toBuffer('image/png');
  
  const bmpBuffer = Buffer.alloc(width * height * 4 + 54);
  bmpBuffer.write('BM', 0);
  bmpBuffer.writeUInt32LE(bmpBuffer.length, 2);
  bmpBuffer.writeUInt32LE(54, 10);
  bmpBuffer.writeUInt32LE(40, 14);
  bmpBuffer.writeUInt32LE(width, 18);
  bmpBuffer.writeUInt32LE(height, 22);
  bmpBuffer.writeUInt16LE(1, 26);
  bmpBuffer.writeUInt16LE(32, 28);
  bmpBuffer.writeUInt32LE(width * height * 4, 34);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = ((height - 1 - y) * width + x) * 4;
      const dstIdx = 54 + (y * width + x) * 4;
      bmpBuffer[dstIdx] = buffer[srcIdx];
      bmpBuffer[dstIdx + 1] = buffer[srcIdx + 1];
      bmpBuffer[dstIdx + 2] = buffer[srcIdx + 2];
      bmpBuffer[dstIdx + 3] = buffer[srcIdx + 3];
    }
  }

  fs.writeFileSync(path.join(installerDir, 'installer-header.bmp'), bmpBuffer);
  console.log('✓ Created installer-header.bmp (150x57)');
}

async function main() {
  console.log('\n🎨 Generating installer images...\n');
  
  try {
    await createDMGBackground();
    await createWindowsSidebar();
    await createWindowsHeader();
    console.log('\n✅ All installer images generated successfully!\n');
    console.log('Generated files:');
    console.log('  - src-tauri/installer/dmg-background.png');
    console.log('  - src-tauri/installer/installer-sidebar.bmp');
    console.log('  - src-tauri/installer/installer-header.bmp');
  } catch (error) {
    console.error('Error generating images:', error);
    process.exit(1);
  }
}

main();
