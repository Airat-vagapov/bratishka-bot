import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  default: {
    visionMaxImageSize: 1024,
    visionJpegQuality: 80,
  },
}));

import { downloadPhoto, prepareImage, bufferToBase64DataUrl } from '../src/vision.js';

function createSvgBuffer(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="red"/></svg>`;
  return Buffer.from(svg);
}

describe('vision', () => {
  describe('downloadPhoto', () => {
    it('downloads photo by file_id and returns buffer', async () => {
      const expectedBuffer = Buffer.from('image-data');
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(expectedBuffer.buffer.slice(0, expectedBuffer.length)),
        })
      );

      const getFileLink = vi.fn(() => Promise.resolve('https://example.com/photo.jpg'));
      const buffer = await downloadPhoto('file123', getFileLink);

      expect(getFileLink).toHaveBeenCalledWith('file123');
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/photo.jpg');
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('throws on failed download', async () => {
      global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' }));
      const getFileLink = vi.fn(() => Promise.resolve('https://example.com/photo.jpg'));

      await expect(downloadPhoto('file123', getFileLink)).rejects.toThrow('Failed to download photo');
    });
  });

  describe('prepareImage', () => {
    it('resizes and converts image to jpeg', async () => {
      const input = createSvgBuffer(2000, 1000);
      const result = await prepareImage(input);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      // JPEG magic bytes
      expect(result[0]).toBe(0xff);
      expect(result[1]).toBe(0xd8);
      expect(result[2]).toBe(0xff);
    });

    it('throws on invalid image', async () => {
      await expect(prepareImage(Buffer.from('not-an-image'))).rejects.toThrow();
    });
  });

  describe('bufferToBase64DataUrl', () => {
    it('encodes buffer to base64 data url', () => {
      const buffer = Buffer.from('hello');
      const dataUrl = bufferToBase64DataUrl(buffer);
      expect(dataUrl).toBe('data:image/jpeg;base64,' + buffer.toString('base64'));
    });
  });
});
