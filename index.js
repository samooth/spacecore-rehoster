const { asHex, getDiscoveryKey } = require('hexkey-utils')

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

class Rehoster {
  constructor ({ dbInterface, hypercoreInterface, swarmInterface }) {
    this.dbInterface = dbInterface
    this.hypercoreInterface = hypercoreInterface
    this.swarmInterface = swarmInterface
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
    this.dbInterface.addHexKey(asHex(key))
    await this.syncWithDb()
  }

  async close () {
    await Promise.all([
      this.hypercoreInterface.close(),
      this.swarmInterface.close()
    ])
  }
}

module.exports = Rehoster
