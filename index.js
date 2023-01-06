import { getDiscoveryKey } from 'hexkey-utils'
import HyperInterface from 'hyperpubee-hyper-interface'
import SwarmInterface from 'hyperpubee-swarm-interface'
import Hyperbee from 'hyperbee'

import RehosterNode from './lib/rehoster-node.js'
import DbInterface from './lib/db-interface.js'
import { DiGraph } from 'dcent-digraph'

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

export default class Rehoster {
  constructor ({ dbInterface, hypercoreInterface, swarmInterface }) {
    this.dbInterface = dbInterface
    this.hypercoreInterface = hypercoreInterface
    this.swarmInterface = swarmInterface
  }

  get ownKey () {
    return this.dbInterface.bee.feed.key
  }

  get rootNode () {
    return new RehosterNode({
      pubKey: this.ownKey,
      hyperInterface: this.hypercoreInterface,
      swarmInterface: this.swarmInterface
    })
  }

  async syncWithDb () {
    const diGraph = new DiGraph(this.rootNode)

    const keys = []
    const discKeys = []
    for await (const node of diGraph.yieldAllNodesOnce()) {
      keys.push(node.pubKey)
      discKeys.push(getDiscoveryKey(node.pubKey))
    }

    // Serve/request all before reading
    await this.swarmInterface.serveCores(discKeys)
    await this.hypercoreInterface.readCores(keys, OPTS_TO_AUTO_UPDATE)
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
    await this.swarmInterface.close()
    await this.hypercoreInterface.close()
  }

  static async initFrom (
    { beeName = 'rehoster-keyset', corestore, swarm, doSync = true, RehosterClass = Rehoster }
  ) {
    await corestore.ready()
    const swarmInterface = new SwarmInterface(swarm, corestore)

    const hypercoreInterface = new HyperInterface(corestore)
    await hypercoreInterface.ready()

    const core = await corestore.get({ name: beeName })
    const bee = new Hyperbee(core)
    await bee.ready()
    const dbInterface = new DbInterface(bee)

    const res = new RehosterClass({
      dbInterface,
      hypercoreInterface,
      swarmInterface
    })

    if (doSync) await res.syncWithDb()
    return res
  }
}
