const { EventEmitter } = require('events')
const Hyperswarm = require('hyperswarm')

const SwarmInterface = require('./lib/swarm-interface.js')
const RehosterNode = require('./lib/rehoster-node.js')
const DbInterface = require('./lib/db-interface.js')
const Hyperbee = require('hyperbee')

const DEFAULT_BEE_NAME = 'rehoster-bee'

class Rehoster extends EventEmitter {
  constructor (corestore, { bee = undefined, beeName = DEFAULT_BEE_NAME, swarm = undefined } = {}) {
    super()

    bee ??= new Hyperbee(corestore.get({ name: beeName }))
    this.dbInterface = new DbInterface(bee)

    swarm ??= new Hyperswarm()
    this.swarmInterface = new SwarmInterface(swarm, corestore)

    this.rootNode = null

    this._opening = null
    this._closing = null
  }

  async ready () {
    if (this._opening) return this._opening
    this._opening = this._open()
    return this._opening
  }

  async _open () {
    await this.dbInterface.ready()

    this.rootNode = new RehosterNode({
      pubKey: this.ownKey,
      swarmInterface: this.swarmInterface,
      onInvalidKey: (args) => this.emit('invalidKey', args)
    })
    await this.rootNode.ready()
  }

  get bee () {
    return this.dbInterface.bee
  }

  get corestore () {
    return this.swarmInterface.corestore
  }

  get swarm () {
    return this.swarmInterface.swarm
  }

  get ownKey () {
    return this.dbInterface.bee.feed.key
  }

  async add (key) {
    if (!this._opening) await this.ready()
    await this.dbInterface.addKey(key)
  }

  async delete (key) {
    if (!this._opening) await this.ready()
    await this.dbInterface.removeKey(key)
  }

  get servedDiscoveryKeys () {
    return this.swarmInterface.servedDiscoveryKeys
  }

  get replicatedDiscoveryKeys () {
    return this.swarmInterface.replicatedDiscoveryKeys
  }

  async close () {
    if (this._closing) return this._closing
    this._closing = this._close()
    return this._closing
  }

  async _close () {
    await this.rootNode.close()
    await this.dbInterface.close()
    await this.swarmInterface.close()
    await this.corestore.close()
  }
}

module.exports = Rehoster
