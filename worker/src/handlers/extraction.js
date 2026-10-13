import { burn } from './burn.js';

export default async function extraction() {
  await burn(4000);
  return {
    invoiceNo: 'INV-' + Math.floor(Math.random() * 9000 + 1000),
    amount: Math.floor(Math.random() * 50000),
  };
}