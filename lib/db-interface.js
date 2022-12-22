import { validateKey, asBuffer, asHex } from 'hexkey-utils'
import { Transform, pipeline } from 'streamx'

class DbInterface {
  constructor (bee) {
    const encoding = bee.keyEncoding.name
    if (encoding !== null && encoding !== 'binary') {
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

  async getHexKeys () {
    const res = new Set()
    for await (const key of this.getKeyStream()) {
      res.add(asHex(key))
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

export default DbInterface
