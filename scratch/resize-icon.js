import Jimp from 'jimp';
import path from 'path';

async function resizeIcon() {
  const sourcePath = path.resolve('assets/icon.png');
  const targetPath = path.resolve('assets/icon-512.png');
  
  try {
    const image = await Jimp.read(sourcePath);
    await image.resize({ w: 512, h: 512 }).write(targetPath);
    console.log(`Successfully resized icon to ${targetPath}`);
  } catch (error) {
    console.error('Error resizing icon:', error);
    process.exit(1);
  }
}

resizeIcon();
