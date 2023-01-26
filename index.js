const { EventEmitter } = require('events')
const Hyperswarm = require('hyperswarm')
const Hyperbee = require('hyperbee')

const SwarmInterface = require('./lib/swarm-interface.js')
const RehosterNode = require('./lib/rehoster-node.js')
const DbInterface = require('./lib/db-interface.js')
const { ensureIsRehoster } = require('./lib/utils.js')

class Rehoster extends EventEmitter {
  constructor ({ corestore, bee, swarm = undefined }) {
    super()

    this.dbInterface = new DbInterface(bee)

    swarm ??= new Hyperswarm()
    this.swarmInterface = new SwarmInterface(swarm, corestore)

    this.rootNode = new RehosterNode({
      pubKey: this.ownKey,
      swarmInterface: this.swarmInterface,
      onInvalidKey: (args) => this.emit('invalidKey', args)
    })

    this._ready = ensureIsRehoster(bee)
      .then(this.rootNode.ready())
      .catch(e => { throw e })
  }

  async ready () {
    await this._ready
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
    await this.dbInterface.addKey(key)
  }

  async delete (key) {
    await this.dbInterface.removeKey(key)
  }

  get servedDiscoveryKeys () {
    return this.swarmInterface.servedDiscoveryKeys
  }

  get replicatedDiscoveryKeys () {
    return this.swarmInterface.replicatedDiscoveryKeys
  }

  async close () {
    await this.swarmInterface.close()
    await this.corestore.close()
  }

  static async initFrom (
    { beeName = 'rehoster-keys', corestore, swarm = undefined }
  ) {
    await corestore.ready()

    const core = await corestore.get({ name: beeName })
    const bee = new Hyperbee(core)
    await bee.ready()

    return new Rehoster({ corestore, bee, swarm })
  }
}

module.exports = Rehoster
