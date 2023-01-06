import { BaseNode } from 'dcent-digraph'
import safetyCatch from 'safety-catch'
import Hyperbee from 'hyperbee'
import { asHex, validateKey } from 'hexkey-utils'

import DbInterface from './db-interface.js'

export default class RehosterNode extends BaseNode {
  constructor ({ pubKey, hyperInterface, swarmInterface }) {
    super(asHex(pubKey))

    validateKey(pubKey)
    this.pubKey = pubKey

    this.hyperInterface = hyperInterface
    this.swarmInterface = swarmInterface
  }

  async getChildren () {
    const core = await this.hyperInterface.readCore(this.pubKey)
    if (!core.writable) await this.swarmInterface.requestCore(core)

    await core.ready()
    await core.update()

    const isBee = await Hyperbee.isHyperbee(core)
    if (!isBee) return []

    const bee = new Hyperbee(core)
    try {
      // DEVNOTE: duck-typing: we assume it is a rehoster if it resembles one.
      // Will also match other hyperbees with only hypercore keys as keys
      const dbInterface = new DbInterface(bee)

      const res = []
      for await (const pubKey of dbInterface.getKeyStream()) {
        validateKey(pubKey)
        res.push(new RehosterNode(
          { pubKey, hyperInterface: this.hyperInterface, swarmInterface: this.swarmInterface }
        ))
      }

      return res
    } catch (err) {
      // Not a rehoster
      safetyCatch(err)
      return []
    }
  }
}
