import { burn } from './burn.js';

export default async function ocr({ payload }) {
  await burn(8000);
  return { pages: 4, text: `Extracted text from ${payload?.filename ?? 'document'}` };
}
