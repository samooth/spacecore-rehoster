const SubEncoder = require('sub-encoder')
const cenc = require('compact-encoding')

const subEnc = new SubEncoder()

// Note: we do not use fixed32 buffers because
// - we can detect it's an invalid key AFTER getting the entry (instead of having to try-catch getting the entry)
// - Accidentally-added strings get auto-converted to a fixed32 buffer, making them look like keys
const REHOSTER_SUB = subEnc.sub('rehoster-data', cenc.buffer)

const MAJOR_VERSION = 1
const MINOR_VERSION = 1

const RehosterValueEnc = {
  preencode (state, m) {
    cenc.uint.preencode(state, 0) // flags

    cenc.uint.preencode(state, m.version?.major || MAJOR_VERSION)
    cenc.uint.preencode(state, m.version?.minor || MINOR_VERSION)

    if (m.description) {
      cenc.string.preencode(state, m.description)
    }
  },

  encode (state, m) {
    let flags = 0
    if (m.description) {
      flags |= 1
    }
    cenc.uint.encode(state, flags)

    cenc.uint.encode(state, m.version?.major || MAJOR_VERSION)
    cenc.uint.encode(state, m.version?.minor || MINOR_VERSION)

    if (m.description) {
      cenc.string.encode(state, m.description)
    }
  },

  decode (state) {
    const flags = cenc.uint.decode(state)

    const major = cenc.uint.decode(state)
    const minor = cenc.uint.decode(state)
    if (major !== MAJOR_VERSION) {
      throw new Error(`Cannot decode Rehoster entry of other major version ${major} (own major: ${MAJOR_VERSION})`)
    }
    if (minor > MINOR_VERSION) {
      throw new Error(`Cannot decode Rehoster entry of higher minor version ${minor} (own minor: ${MINOR_VERSION})`)
    }

    const res = {
      version: {
        major,
        minor
      },
      description: (flags & 1) !== 0 ? cenc.string.decode(state) : null
    }

    return res
  }
}

module.exports = {
  REHOSTER_SUB,
  RehosterValueEnc,
  REHOSTER_ENCODINGS: {
    keyEncoding: REHOSTER_SUB,
    valueEncoding: RehosterValueEnc
  },
  CURRENT_VERSION: {
    major: MAJOR_VERSION,
    minor: MINOR_VERSION
  }
}
