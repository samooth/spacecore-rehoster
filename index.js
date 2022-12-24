import { getDiscoveryKey } from 'hexkey-utils'
import HyperInterface from 'hyperpubee-hyper-interface'
import SwarmInterface from 'hyperpubee-swarm-interface'
import Hyperbee from 'hyperbee'

import DbInterface from './lib/db-interface.js'

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

export default class Rehoster {
  constructor ({ dbInterface, hypercoreInterface, swarmInterface }) {
    this.dbInterface = dbInterface
    this.hypercoreInterface = hypercoreInterface
    this.swarmInterface = swarmInterface
  }

  async syncWithDb () {
    const keys = await this.dbInterface.getHexKeys()
    const discKeys = keys.map((key) => getDiscoveryKey(key))

    // Serve all before reading
    await this.swarmInterface.serveCores(discKeys)
    await this.hypercoreInterface.readHypercores(keys, OPTS_TO_AUTO_UPDATE)
  }

  async addCore (key, { doSync = true } = {}) {
    await this.dbInterface.addKey(key)
    if (doSync) await this.syncWithDb()
  }

  async addCores (keys, { doSync = true } = {}) {
    try {
      await Promise.all(
        keys.map((key) => this.addCore(key, { doSync: false }))
      )
    } finally {
      if (doSync) await this.syncWithDb()
    }
  }

  get servedDiscoveryKeys () {
    return this.swarmInterface.servedDiscoveryKeys
  }

  async close () {
    await Promise.all([
      this.hypercoreInterface.close(),
      this.swarmInterface.close()
    ])
  }

  static async initFrom (
    { beeName = 'rehoster-keyset', corestore, swarm, doSync = true }
  ) {
    await corestore.ready()
    const swarmInterface = new SwarmInterface(swarm, corestore)

    const hypercoreInterface = new HyperInterface(corestore)
    await hypercoreInterface.ready()

    const core = await corestore.get({ name: beeName })
    const bee = new Hyperbee(core, { keyEncoding: 'binary' })
    await bee.ready()
    const dbInterface = new DbInterface(bee)

    const res = new Rehoster({
      dbInterface,
      hypercoreInterface,
      swarmInterface
    })

    if (doSync) await res.syncWithDb()
    return res
  }
}
