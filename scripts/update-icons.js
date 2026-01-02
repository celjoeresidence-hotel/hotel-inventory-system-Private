
import fs from 'fs';
import path from 'path';
import pngToIco from 'png-to-ico';

const publicDir = path.resolve('public');
const electronDir = path.resolve('electron');
const buildDir = path.resolve('build');

const sourceImage = path.join(publicDir, 'celjoe.png');

if (!fs.existsSync(sourceImage)) {
  console.error('Source image not found:', sourceImage);
  process.exit(1);
}

// 1. Copy to electron/logo.png for Splash Screen
fs.copyFileSync(sourceImage, path.join(electronDir, 'logo.png'));
console.log('Copied to electron/logo.png');

// 2. Copy to build/icon.png for Linux/Mac/Builder
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir);
}
fs.copyFileSync(sourceImage, path.join(buildDir, 'icon.png'));
console.log('Copied to build/icon.png');

// 3. Generate build/icon.ico for Windows
pngToIco(sourceImage)
  .then(buf => {
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), buf);
    console.log('Generated build/icon.ico');
  })
  .catch(err => {
    console.error('Error converting to ICO:', err);
  });
