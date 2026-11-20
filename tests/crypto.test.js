/**
 * اختبار ترميز Base64 للتخزين المشفّر — الكتب الكبيرة كانت تتجاوز
 * حدّ مكدس الاستدعاء عند استخدام String.fromCharCode(...bytes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, base64ToBytes } from '../public/features/save/crypto.js';

test('ترميز وفك ترميز بيانات كبيرة دون تجاوز المكدس', () => {
  const size = 2_500_000;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;

  const encoded = bytesToBase64(bytes);
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.length > size);

  const decoded = base64ToBytes(encoded);
  assert.equal(decoded.length, size);
  assert.equal(decoded[0], bytes[0]);
  assert.equal(decoded[1], bytes[1]);
  assert.equal(decoded[size - 1], bytes[size - 1]);
  assert.equal(decoded[123_456], bytes[123_456]);
});

test('ترميز بايتات فارغة وصغيرة', () => {
  assert.equal(bytesToBase64(new Uint8Array()), '');
  assert.deepEqual([...base64ToBytes('')], []);
  assert.equal(new TextDecoder().decode(base64ToBytes(bytesToBase64(new TextEncoder().encode('مرحبا')))), 'مرحبا');
});
