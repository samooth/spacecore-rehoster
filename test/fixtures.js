import createTestnet from '@hyperswarm/testnet'
import SwarmInterface from '../lib/swarm-interface.js'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import ram from 'random-access-memory'
import HyperInterface from 'hyperpubee-hyper-interface'

import DbInterface from '../lib/db-interface.js'

export async function testnetFactory (corestore1, corestore2) {
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

export async function hyperInterfaceFactory () {
  const corestore = new Corestore(ram)

  const hyperInterface = new HyperInterface(corestore)
  await hyperInterface.ready()

  return hyperInterface
}

export async function dbInterfaceFactory (hyperInterface) {
  hyperInterface ??= await hyperInterfaceFactory()

  const bee = await hyperInterface.createBee(`${Math.random()}`)
  return new DbInterface(bee)
}
