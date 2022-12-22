import { getDiscoveryKey } from 'hexkey-utils'
import HyperInterface from 'hyperpubee-hyper-interface'
import SwarmInterface from 'hyperpubee-swarm-interface'
import Hyperbee from 'hyperbee'
import stream from 'streamx'
import cloneable from 'cloneable-readable'

import DbInterface from './lib/db-interface.js'

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

export default class Rehoster {
  constructor ({ dbInterface, hypercoreInterface, swarmInterface }) {
    this.dbInterface = dbInterface
    this.hypercoreInterface = hypercoreInterface
    this.swarmInterface = swarmInterface
    this._firstSyncDone = false

    this.syncWithDb()
  }

  async ready () {
    if (!this._firstSyncDone) await this.syncWithDb()
  }

  async syncWithDb () {
    const keyStream = cloneable(this.dbInterface.getKeyStream())

    const keys = []
    keyStream.clone().on('data', (key) => keys.push(key))

    const toDiscoveryKey = new stream.Transform(
      { transform: (key, cb) => cb(null, key ? getDiscoveryKey(key) : null) }
    )
    const discKeyStream = stream.pipeline([keyStream, toDiscoveryKey])

    // Serve all before reading
    await this.swarmInterface.serveCores(discKeyStream)

    const readPromises = keys.map((key) =>
      this.hypercoreInterface.readHypercore(key, OPTS_TO_AUTO_UPDATE)
    )
    await Promise.all(readPromises)
    this._firstSyncDone = true
  }

  async addCore (key, { doSync = true } = {}) {
    await this.dbInterface.addKey(key)
    if (doSync) await this.syncWithDb()
  }

  async addCores (keys) {
    try {
      await Promise.all(
        keys.map((key) => this.addCore(key, { doSync: false }))
      )
    } finally {
      await this.syncWithDb()
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

  static async initFrom ({ beeName = 'rehoster-keyset', corestore, swarm }) {
    await corestore.ready()
    const swarmInterface = new SwarmInterface(swarm, corestore)

    const hypercoreInterface = new HyperInterface(corestore)
    await hypercoreInterface.ready()

    const core = await corestore.get({ name: beeName })
    const bee = new Hyperbee(core, { keyEncoding: 'binary' })
    await bee.ready()
    const dbInterface = new DbInterface(bee)

    return new Rehoster({
      dbInterface,
      hypercoreInterface,
      swarmInterface
    })
  }
}
