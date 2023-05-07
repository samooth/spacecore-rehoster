const Hyperswarm = require('hyperswarm')
const Hyperbee = require('hyperbee')
const ReadyResource = require('ready-resource')

const SwarmManager = require('swarm-manager')
const RehosterNode = require('./lib/rehoster-node.js')
const DbInterface = require('./lib/db-interface.js')
const { METADATA_SUB } = require('./lib/constants.js')

const DEFAULT_BEE_NAME = 'rehoster-bee'

class Rehoster extends ReadyResource {
  constructor (corestore, { bee = undefined, beeName = DEFAULT_BEE_NAME, swarm = undefined } = {}) {
    super()

    bee ??= new Hyperbee(corestore.get({ name: beeName }))
    this.dbInterface = new DbInterface(bee)

    swarm ??= new Hyperswarm()
    this.swarmManager = new SwarmManager(swarm, corestore)

    this.rootNode = null
  }

  static get SUB () {
    return METADATA_SUB
  }

  async _open () {
    await this.dbInterface.ready()

    this.rootNode = new RehosterNode({
      pubKey: this.ownKey,
      swarmManager: this.swarmManager,
      onInvalidKey: (args) => this.emit('invalidKey', args)
    })
    await this.rootNode.ready()
    this.rootNode.on('error', (err) => this.emit('error', err))
  }

  get bee () {
    return this.dbInterface.bee
  }

  get corestore () {
    return this.swarmManager.store
  }

  get swarm () {
    return this.swarmManager.swarm
  }

  get ownKey () {
    return this.dbInterface.bee.feed.key
  }

  async add (key) {
    if (!this.opened) await this.ready()
    await this.dbInterface.addKey(key)
  }

  async delete (key) {
    if (!this.opened) await this.ready()
    await this.dbInterface.removeKey(key)
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
    await this.swarmManager.close()
    await this.corestore.close()
  }
}

module.exports = Rehoster
