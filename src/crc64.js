const REVERSED_POLYNOMIAL = 0x9a6c9329ac4bc9b5n
const UINT32_MASK = 0xffffffffn

function createTables() {
  return Array.from({ length: 8 }, (_, slice) => {
    const table = new Uint32Array(512)
    for (let value = 0; value < 256; value += 1) {
      let crc = BigInt(value)
      for (let bit = 0; bit < 8 * (slice + 1); bit += 1)
        crc =
          crc & 1n ? (crc >> 1n) ^ REVERSED_POLYNOMIAL : crc >> 1n
      table[value * 2] = Number((crc >> 32n) & UINT32_MASK)
      table[value * 2 + 1] = Number(crc & UINT32_MASK)
    }
    return table
  })
}

const [t0, t1, t2, t3, t4, t5, t6, t7] = createTables()

export class Crc64Nvme {
  high = 0xffffffff
  low = 0xffffffff

  update(bytes) {
    let { high, low } = this
    let offset = 0
    while (offset + 8 <= bytes.length) {
      const i0 = ((low ^ bytes[offset++]) & 0xff) << 1
      const i1 = (((low >>> 8) ^ bytes[offset++]) & 0xff) << 1
      const i2 = (((low >>> 16) ^ bytes[offset++]) & 0xff) << 1
      const i3 = (((low >>> 24) ^ bytes[offset++]) & 0xff) << 1
      const i4 = ((high ^ bytes[offset++]) & 0xff) << 1
      const i5 = (((high >>> 8) ^ bytes[offset++]) & 0xff) << 1
      const i6 = (((high >>> 16) ^ bytes[offset++]) & 0xff) << 1
      const i7 = (((high >>> 24) ^ bytes[offset++]) & 0xff) << 1
      high =
        t7[i0] ^
        t6[i1] ^
        t5[i2] ^
        t4[i3] ^
        t3[i4] ^
        t2[i5] ^
        t1[i6] ^
        t0[i7]
      low =
        t7[i0 + 1] ^
        t6[i1 + 1] ^
        t5[i2 + 1] ^
        t4[i3 + 1] ^
        t3[i4 + 1] ^
        t2[i5 + 1] ^
        t1[i6 + 1] ^
        t0[i7 + 1]
    }
    while (offset < bytes.length) {
      const index = ((low ^ bytes[offset++]) & 0xff) << 1
      low = ((low >>> 8) | ((high & 0xff) << 24)) >>> 0
      high = (high >>> 8) ^ t0[index]
      low ^= t0[index + 1]
    }
    this.high = high
    this.low = low
    return this
  }

  digestBase64() {
    const high = this.high ^ 0xffffffff
    const low = this.low ^ 0xffffffff
    return Buffer.from([
      high >>> 24,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      low >>> 24,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    ]).toString('base64')
  }
}

export function crc64NvmeBase64(bytes) {
  return new Crc64Nvme().update(bytes).digestBase64()
}
