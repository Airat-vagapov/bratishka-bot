const sharp = require('sharp');
const config = require('./config');

/**
 * Скачивает фото из Telegram по file_id через переданную функцию getFileLink.
 * @param {string} fileId
 * @param {(fileId: string) => Promise<string>} getFileLink
 * @returns {Promise<Buffer>}
 */
async function downloadPhoto(fileId, getFileLink) {
  const url = await getFileLink(fileId);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download photo: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Подготавливает изображение для отправки в AI:
 * - ресайзит так, чтобы большая сторона не превышала VISION_MAX_IMAGE_SIZE,
 * - конвертирует в JPEG с качеством VISION_JPEG_QUALITY.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function prepareImage(buffer) {
  return sharp(buffer)
    .resize({
      width: config.visionMaxImageSize,
      height: config.visionMaxImageSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.visionJpegQuality, progressive: true })
    .toBuffer();
}

/**
 * Кодирует буфер изображения в base64 data URL.
 * @param {Buffer} buffer
 * @returns {string}
 */
function bufferToBase64DataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

module.exports = {
  downloadPhoto,
  prepareImage,
  bufferToBase64DataUrl,
};
