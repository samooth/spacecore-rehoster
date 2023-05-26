const KEY_ENCODING = 'binary'
const VALUE_ENCODING = 'json'

module.exports = {
  METADATA_SUB: '\x00\x00\x00rehoster_key',
  ENCODINGS: { keyEncoding: KEY_ENCODING, valueEncoding: VALUE_ENCODING },
  KEY_ENCODING
}
