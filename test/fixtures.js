const createTestnet = require('@hyperswarm/testnet')
const SwarmInterface = require('../lib/swarm-interface.js')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const HyperInterface = require('hyperpubee-hyper-interface')

const DbInterface = require('../lib/db-interface.js')

async function testnetFactory (corestore1, corestore2) {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const swarmInterface1 = new SwarmInterface(
    new Hyperswarm({ bootstrap }),
    corestore1
  )
  const swarmInterface2 = new SwarmInterface(
    new Hyperswarm({ bootstrap }),
    corestore2
  )

  async function destroyTestnetFactory () {
    await Promise.all([
      swarmInterface2.close(),
      swarmInterface1.close()
    ])
    await testnet.destroy()
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

  const hyperInterface = new HyperInterface(corestore)
  await hyperInterface.ready()

  return hyperInterface
}

async function dbInterfaceFactory (hyperInterface) {
  hyperInterface ??= await hyperInterfaceFactory()

  const bee = await hyperInterface.createBee(`${Math.random()}`)
  return new DbInterface(bee)
}

module.exports = {
  dbInterfaceFactory,
  hyperInterfaceFactory,
  testnetFactory
}
