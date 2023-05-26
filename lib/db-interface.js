const { validateKey, asBuffer, asHex } = require('hexkey-utils')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const { Transform, pipeline } = require('streamx')

const { ensureIsRehoster } = require('./utils.js')

class DbInterface extends ReadyResource {
  constructor (bee) {
    super()
    this.bee = bee
  }

  async _open () {
    await this.bee.ready()
    await ensureIsRehoster(this.bee)

    const encoding = this.bee.keyEncoding?.name
    if (encoding != null && encoding !== 'binary') {
      throw new Error(
        `DbInterface must have default (binary) keyEncoding--received '${encoding}'`
      )
    }
  }

  async _close () {
    await this.bee.close()
  }

  async addKey (key, value) {
    validateKey(key)
    await this.bee.put(asBuffer(key), value)
  }

  async getKey (key) {
    return await this.bee.get(asBuffer(key))
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
