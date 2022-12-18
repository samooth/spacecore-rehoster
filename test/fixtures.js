const createTestnet = require('@hyperswarm/testnet')
const SwarmInterface = require('hyperpubee-swarm-interface')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const HyperInterface = require('hyperpubee-hyper-interface')
const Hyperswarm = require('hyperswarm')
const DbInterface = require('../lib/db-interface')
const sqlite3 = require('better-sqlite3')

async function testnetFactory (corestore1, corestore2) {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const swarmInterface1 = new SwarmInterface(
    new Hyperswarm(bootstrap),
    corestore1
  )
  const swarmInterface2 = new SwarmInterface(
    new Hyperswarm(bootstrap),
    corestore2
  )

  async function destroyTestnetFactory () {
    await Promise.all([
      swarmInterface2.close(),
      swarmInterface1.close(),
      testnet.destroy()
    ])
  }

  return {
    testnet,
    bootstrap,
    swarmInterface1,
    swarmInterface2,
    destroy: destroyTestnetFactory
  }
}

async function hyperInterfaceFactory () {
  const corestore = new Corestore(ram)
  await corestore.ready()

  const hyperInterface = new HyperInterface(corestore)
  return hyperInterface
}

function dbInterfaceFactory () {
  const db = sqlite3(':memory:')
  const dbInterface = new DbInterface(db)

  return dbInterface
}

module.exports = {
  testnetFactory,
  hyperInterfaceFactory,
  dbInterfaceFactory
}
