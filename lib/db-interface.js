const { validateKey, asBuffer, asHex } = require('hexkey-utils')
const safetyCatch = require('safety-catch')
const { Transform, pipeline } = require('streamx')

class DbInterface {
  constructor (bee) {
    const encoding = bee.keyEncoding?.name
    if (encoding != null && encoding !== 'binary') {
      throw new Error(
        `DbInterface must have default (binary) keyEncoding--received '${encoding}'`
      )
    }
    this.bee = bee
  }

  async addKey (key) {
    validateKey(key)
    await this.bee.put(asBuffer(key))
  }

  async removeKey (key) {
    try {
      key = asBuffer(key)
    } catch (err) {
      safetyCatch(err)
      return // Invalid key can't be present
    }
    await this.bee.del(key)
  }

  async getHexKeys () {
    const res = []
    for await (const key of this.getKeyStream()) {
      res.push(asHex(key))
    }
    return res
  }

  getKeyStream () {
    const readStream = this.bee.createReadStream()
    const keyExtractor = new Transform({
      transform: (entry, cb) => cb(null, entry.key)
    })
    return pipeline([readStream, keyExtractor])
  }
}

module.exports = DbInterface
