import { burn } from './burn.js';

export default async function conversion({ payload }) {
  await burn(3000);
  return { output: `converted-${payload?.filename ?? 'document'}.pdf` };
}
