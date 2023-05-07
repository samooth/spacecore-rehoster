const createTestnet = require('@hyperswarm/testnet')
const SwarmManager = require('swarm-manager')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const ram = require('random-access-memory')
const HyperInterface = require('hyperpubee-hyper-interface')

const DbInterface = require('../lib/db-interface.js')

async function testnetFactory (corestore1, corestore2) {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const swarmManager1 = new SwarmManager(
    new Hyperswarm({ bootstrap }),
    corestore1
  )
  const swarmManager2 = new SwarmManager(
    new Hyperswarm({ bootstrap }),
    corestore2
  )

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
