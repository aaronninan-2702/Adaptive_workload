import test from 'node:test';
import assert from 'node:assert';
import { score, classify } from './engine.js';

test('same operation, different context gives different priority', () => {
  assert.equal(score({ source: 'SCHEDULED', category: 'ROUTINE' }).priority, 'LOW');
  assert.equal(score({ source: 'USER', category: 'NORMAL' }).priority, 'MEDIUM');
  assert.equal(score({ source: 'USER', category: 'LEGAL' }).priority, 'HIGH');
  assert.equal(score({ source: 'EMERGENCY', category: 'SECURITY' }).score, 100);
});

test('classify reads the filename', () => {
  assert.equal(classify('Contract-77.pdf'), 'LEGAL');
  assert.equal(classify('invoice_501.pdf'), 'FINANCIAL');
  assert.equal(classify('notes.txt'), 'ROUTINE');
});