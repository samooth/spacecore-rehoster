const createTestnet = require('@hyperswarm/testnet')
const SwarmManager = require('swarm-manager')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const safetyCatch = require('safety-catch')
const Hyperbee = require('hyperbee')
const { asBuffer } = require('hexkey-utils')

const DbInterface = require('../lib/db-interface.js')

async function testnetFactory (corestore1, corestore2) {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const swarm1 = new Hyperswarm({ bootstrap })
  swarm1.on('connection', (socket) => {
    corestore1.replicate(socket)
    socket.on('error', safetyCatch)
  })
  const swarm2 = new Hyperswarm({ bootstrap })
  swarm2.on('connection', (socket) => {
    corestore2.replicate(socket)
    socket.on('error', safetyCatch)
  })

  const swarmManager1 = new SwarmManager(swarm1, corestore1)
  const swarmManager2 = new SwarmManager(swarm2, corestore2)

  async function destroyTestnetFactory () {
    await Promise.all([
      swarmManager2.close(),
      swarmManager1.close()
    ])
    await testnet.destroy()
  }

  return {
    testnet,
    bootstrap,
    swarmManager1,
    swarmManager2,
    destroy: destroyTestnetFactory
  }
}

class HyperInterface {
  constructor (corestore) {
    this.corestore = corestore
  }

  async createCore (name) {
    const core = this.corestore.get({ name })
    await core.ready()

    return core
  }

  async createBee (name, opts) {
    const core = await this.createCore(name)
    const bee = new Hyperbee(core, opts)
    await bee.ready()

    return bee
  }

  async readCore (key, opts) {
    const core = this.corestore.get({ ...opts, key: asBuffer(key) })
    await core.ready()
    return core
  }

  async close () {
    await this.corestore.close()
  }
}

async function hyperInterfaceFactory () {
  const corestore = new Corestore(ram)

  const hyperInterface = new HyperInterface(corestore)

  return hyperInterface
}

async function dbInterfaceFactory (hyperInterface) {
  hyperInterface ??= await hyperInterfaceFactory()

  const bee = await hyperInterface.createBee(
    `${Math.random()}`,
    { valueEncoding: 'json' }
  )
  return new DbInterface(bee)
}

module.exports = {
  dbInterfaceFactory,
  hyperInterfaceFactory,
  testnetFactory
}
