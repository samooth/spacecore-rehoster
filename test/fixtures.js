const createTestnet = require('@hyperswarm/testnet')
const SwarmInterface = require('hyperpubee-swarm-interface')
const Hyperswarm = require('hyperswarm')
const DbInterface = require('../lib/db-interface')

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

function dbInterfaceFactory () {
  return DbInterface.initFromConnectionStr(':memory:')
}

module.exports = {
  testnetFactory,
  dbInterfaceFactory
}
