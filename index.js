const Hyperbee = require('hyperbee')
const ReadyResource = require('ready-resource')

const RehosterNode = require('./lib/rehoster-node.js')
const DbInterface = require('./lib/db-interface.js')
const { METADATA_SUB, ENCODINGS } = require('./lib/constants.js')

const DEFAULT_BEE_NAME = 'rehoster-bee'

class Rehoster extends ReadyResource {
  constructor (corestore, swarmManager, {
    bee = undefined,
    beeName = DEFAULT_BEE_NAME
  } = {}) {
    super()

    this.swarmManager = swarmManager
    this.corestore = corestore

    bee ??= new Hyperbee(
      corestore.get({ name: beeName }),
      ENCODINGS
    )
    this.dbInterface = new DbInterface(bee)

    this.rootNode = null
  }

  static get SUB () {
    return METADATA_SUB
  }

  async _open () {
    await this.dbInterface.ready()

    this.rootNode = new RehosterNode({
      pubKey: this.ownKey,
      info: 'The rehoster itself',
      swarmManager: this.swarmManager,
      corestore: this.corestore,
      onInvalidKey: (args) => this.emit('invalidKey', args)
    })
    await this.rootNode.ready()
    this.rootNode.on('error', (err) => this.emit('error', err))
  }

  get bee () {
    return this.dbInterface.bee
  }

  get swarm () {
    return this.swarmManager.swarm
  }

  get ownKey () {
    return this.dbInterface.bee.feed.key
  }

  async add (key, value = undefined) {
    if (!this.opened) await this.ready()
    await this.dbInterface.addKey(key, value)
  }

  async delete (key) {
    if (!this.opened) await this.ready()
    await this.dbInterface.removeKey(key)
  }

  async get (key) {
    if (!this.opened) await this.ready()
    return await this.dbInterface.getKey(key)
  }

  get servedKeys () {
    return this.swarmManager.servedKeys
  }

  get requestedKeys () {
    return this.swarmManager.requestedKeys
  }

  get keys () {
    return this.swarmManager.keys
  }

  async _close () {
    await this.rootNode.close()
    await this.dbInterface.close()
    await this.corestore.close()
  }
}

module.exports = Rehoster
