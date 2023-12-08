const { validateKey, asBuffer, asHex, asZBase32 } = require('hexkey-utils')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const { Transform, pipeline } = require('streamx')
const b4a = require('b4a')
const sameObject = require('same-object')

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

  async addKey (key, value = null) {
    if (!this.opened) await this.ready()

    validateKey(key)
    await this.bee.put(asBuffer(key), value, {
      cas: (prev, next) => {
        if (!prev) return true
        if (!b4a.equals(prev.key, next.key)) return true
        if (!sameObject(prev.value, next.value)) return true
        return false
      }
    })
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

  async sync (state) {
    if (!this.opened) await this.ready()

    const toDel = []
    for await (const key of this.getKeyStream()) {
      const hexKey = asHex(key)
      const z32Key = asZBase32(key)
      if (state[hexKey] == null && state[z32Key] == null) {
        toDel.push(this.removeKey(key))
      }
    }

    const toAdd = []
    for (const [key, value] of Object.entries(state)) {
      toAdd.push(this.addKey(key, value))
    }

    await Promise.all([...toAdd, ...toDel])
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

  getKeyInfoStream () {
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
