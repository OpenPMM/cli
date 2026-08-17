import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Crc64Nvme, crc64NvmeBase64 } from '../src/crc64.js'

test('CRC64NVME matches the standard check value and supports chunks', () => {
  const bytes = Buffer.from('123456789')
  assert.equal(crc64NvmeBase64(bytes), 'rosUhgp5mIg=')
  assert.equal(
    new Crc64Nvme()
      .update(bytes.subarray(0, 4))
      .update(bytes.subarray(4))
      .digestBase64(),
    'rosUhgp5mIg='
  )
})
