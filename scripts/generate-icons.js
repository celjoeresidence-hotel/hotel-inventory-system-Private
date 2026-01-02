
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import pngToIco from 'png-to-ico';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');

async function generateIcons() {
  console.log('Generating icons...');

  try {
    // 1. Convert SVG to PNG (512x512)
    console.log('Converting SVG to PNG...');
    await sharp(svgPath)
      .resize(512, 512)
      .png()
      .toFile(pngPath);
    console.log('PNG generated at:', pngPath);

    // 2. Convert PNG to ICO
    console.log('Converting PNG to ICO...');
    const buf = await pngToIco(pngPath);
    fs.writeFileSync(icoPath, buf);
    console.log('ICO generated at:', icoPath);

    console.log('Icon generation complete!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
