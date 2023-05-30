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

    const keyEncoding = this.bee.keyEncoding?.name
    if (keyEncoding != null && keyEncoding !== 'binary') {
      throw new Error(
        `DbInterface must have default (binary) keyEncoding--received '${keyEncoding}'`
      )
    }

    const valueEncoding = this.bee.valueEncoding?.name
    if (valueEncoding !== 'json') {
      throw new Error(
        `DbInterface must have JSON value encoding--received '${valueEncoding}'`
      )
    }
  }

  async _close () {
    await this.bee.close()
  }

  async addKey (key, value) {
    if (!this.opened) await this.ready()

    validateKey(key)
    await this.bee.put(asBuffer(key), value)
  }

  async getKey (key) {
    if (!this.opened) await this.ready()

    return await this.bee.get(asBuffer(key))
  }

  async removeKey (key) {
    if (!this.opened) await this.ready()

    try {
      key = asBuffer(key)
    } catch (err) {
      safetyCatch(err)
      return // Invalid key can't be present
    }
    await this.bee.del(key)
  }

  async getHexKeys () {
    if (!this.opened) await this.ready()

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

  getEntryStream () {
    const readStream = this.bee.createReadStream()
    const transformer = new Transform({
      transform: (entry, cb) => {
        const res = { key: asHex(entry.key) }
        if (entry.value?.info) res.info = entry.value?.info
        cb(null, res)
      }
    })
    return pipeline([readStream, transformer])
  }
}

module.exports = DbInterface
