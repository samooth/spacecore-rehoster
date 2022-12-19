const { asHex, getDiscoveryKey } = require('hexkey-utils')
const HyperInterface = require('hyperpubee-hyper-interface')
const SwarmInterface = require('hyperpubee-swarm-interface')

const DbInterface = require('./lib/db-interface')

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

class Rehoster {
  constructor ({ dbInterface, hypercoreInterface, swarmInterface }) {
    this.dbInterface = dbInterface
    this.hypercoreInterface = hypercoreInterface
    this.swarmInterface = swarmInterface
  }

  async ready () {
    await this.syncWithDb()
  }

  async syncWithDb () {
    const desiredKeys = [...this.dbInterface.getHexKeys()]
    const discToPubKeyMap = new Map(desiredKeys.map(
      (key) => [getDiscoveryKey(key), key]
    ))

    const existingDiscoveryKeys = this.swarmInterface.servedDiscoveryKeys
    const discoveryKeysToAdd = desiredKeys
      .map((key) => getDiscoveryKey(key))
      .filter((discKey) => !existingDiscoveryKeys.includes(discKey))

    await this.swarmInterface.serveCores(discoveryKeysToAdd)
    const readPromises = discoveryKeysToAdd.map(
      (discKey) => this.hypercoreInterface.readHypercore(
        discToPubKeyMap.get(discKey), OPTS_TO_AUTO_UPDATE
      )
    )
    await Promise.all(readPromises)
  }

  async addCore (key) {
    try {
      this.dbInterface.addHexKey(asHex(key))
    } catch (error) {
      if (error.message !== 'UNIQUE constraint failed: core.hexKey') {
        // already added is fine
        throw error
      }
      return false
    }

    await this.syncWithDb()
    return true
  }

  async addCores (keys) {
    for (const key of keys) {
      try {
        this.dbInterface.addHexKey(asHex(key))
      } catch (error) {
        if (error.message !== 'UNIQUE constraint failed: core.hexKey') {
          // already added is fine--else:
          await this.syncWithDb()
          throw error
        }
      }
    }

    await this.syncWithDb()
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

  static async initFrom ({ dbConnectionStr, corestore, swarm }) {
    const dbInterface = DbInterface.initFromConnectionStr(dbConnectionStr)

    await corestore.ready()
    const swarmInterface = new SwarmInterface(swarm, corestore)

    const hypercoreInterface = new HyperInterface(corestore)
    await hypercoreInterface.ready()

    const res = new Rehoster({ dbInterface, hypercoreInterface, swarmInterface })
    await res.ready()
    return res
  }
}

module.exports = Rehoster
