const idEnc = require('hypercore-id-encoding')
const safetyCatch = require('safety-catch')

const { REHOSTER_ENCODINGS } = require('./lib/encodings')

class RehosterDb {
  constructor (bee) {
    this.bee = bee
    this._syncing = null
  }

  async add (key, value = {}) {
    key = idEnc.decode(key)

    const entry = {
      description: value.description || null,
      version: {
        major: value.major || null,
        minor: value.minor || null
      }
    }

    await this.bee.put(key, entry, {
      cas: (prev, next) => { // only if new or different value
        if (!prev) return true
        return prev.value.description !== next.value.description
      },
      ...REHOSTER_ENCODINGS
    })
  }

  async get (key) {
    key = idEnc.decode(key)
    return (await this.bee.get(key, REHOSTER_ENCODINGS))?.value || null
  }

  async has (key) {
    key = idEnc.decode(key)

    return await this.bee.get(key, REHOSTER_ENCODINGS) !== null
  }

  async delete (key) {
    key = idEnc.decode(key)

    await this.bee.del(key, REHOSTER_ENCODINGS)
  }

  // WARNING: The sync method should NOT be used in combination
  // with the add and del methods: no care is taken to avoid
  // race conditions against add and delete operations while
  // a sync is running (only against other syncs)
  async sync (desiredState) {
    // We use obj reference for race-condition control
    // so don't want to get thrown off if the caller
    // re-uses an object across calls
    desiredState = new Map(desiredState)
    this._nextDesiredState = desiredState

    let sanityCheck = 0
    while (this._syncing !== null) {
      try {
        await this._syncing
      } catch (e) {
        safetyCatch(e) // we don't care about errors of other runs
      }

      if (this._nextDesiredState !== desiredState) {
        // more recent desired state has arrived
        return false
      }
      if (sanityCheck++ > 100_000) throw new Error('Almost certian logical bug in Rehoster.sync(...) code')
    }

    try {
      this._syncing = this._sync(desiredState)
      await this._syncing
    } finally {
      this._syncing = null
    }

    return true
  }

  async _sync (desiredState) {
    const normKey = (key) => idEnc.normalize(key)

    const normDesiredState = new Map()
    for (const [key, value] of desiredState) {
      normDesiredState.set(normKey(key), value)
    }

    const toDel = []
    for await (const { key } of this.createReadStream()) {
      if (normDesiredState.get(normKey(key)) === undefined) {
        const delOp = this.delete(key)
        delOp.catch(safetyCatch)
        toDel.push(delOp)
      }
    }

    const toAdd = []
    for (const [key, entry] of normDesiredState) {
      const addOp = this.add(key, entry) // duplicates are no-ops
      addOp.catch(safetyCatch)
      toAdd.push(addOp)
    }

    await Promise.all([...toAdd, ...toDel])
  }

  createReadStream (range = {}) {
    return this.bee.createReadStream(range, REHOSTER_ENCODINGS)
  }
}

module.exports = RehosterDb
