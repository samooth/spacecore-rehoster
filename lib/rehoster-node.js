import { BaseNode } from 'dcent-digraph'
import safetyCatch from 'safety-catch'
import Hyperbee from 'hyperbee'
import { asHex, validateKey, isKey } from 'hexkey-utils'

import DbInterface from './db-interface.js'

async function _getBeeContentFeed (bee) {
  const header = await bee.getHeader()
  return header.metadata?.contentFeed
}

export default class RehosterNode extends BaseNode {
  constructor ({ pubKey, hyperInterface, swarmInterface, shouldAnnounce = true }) {
    super(asHex(pubKey))

    validateKey(pubKey)
    this.pubKey = pubKey
    this.shouldAnnounce = shouldAnnounce

    this.hyperInterface = hyperInterface
    this.swarmInterface = swarmInterface
  }

  async getChildren () {
    const core = await this.hyperInterface.readCore(this.pubKey)
    if (!core.writable) await this.swarmInterface.requestCore(core.discoveryKey)

    await core.ready()
    await core.update()

    const isBee = await Hyperbee.isHyperbee(core)
    if (!isBee) return []

    const bee = new Hyperbee(core)

    const childNodes = []

    // E.g. for hyperdrives: make content-core available, without announcing it
    const contentFeedKey = await _getBeeContentFeed(bee)
    if (contentFeedKey && isKey(contentFeedKey)) {
      childNodes.push(this._createNode(contentFeedKey, { shouldAnnounce: false }))
    }

    childNodes.push(...(await this._getRehosterKeysIn(bee)))
    return childNodes
  }

  _createNode (pubKey, opts = {}) {
    return new RehosterNode({
      pubKey,
      hyperInterface: this.hyperInterface,
      swarmInterface: this.swarmInterface,
      ...opts
    })
  }

  async _getRehosterKeysIn (bee) {
    const keysToRehost = []

    try {
      // DEVNOTE: duck-typing: we assume it is a rehoster if it resembles one.
      // Will also match other hyperbees with only hypercore keys as keys
      const dbInterface = new DbInterface(bee)

      for await (const pubKey of dbInterface.getKeyStream()) {
        validateKey(pubKey)
        keysToRehost.push(this._createNode(pubKey))
      }
    } catch (err) {
      // Not a rehoster
      safetyCatch(err)
      return []
    }

    return keysToRehost
  }
}
