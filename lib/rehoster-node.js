import safetyCatch from 'safety-catch'
import Hyperbee from 'hyperbee'
import { validateKey, isKey, asHex, asBuffer } from 'hexkey-utils'
import debounceify from 'debounceify'

import { isRehoster } from './utils.js'

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

export default class RehosterNode {
  constructor ({ pubKey, swarmInterface, shouldAnnounce = true, onInvalidKey = undefined }) {
    validateKey(pubKey)
    this.pubKey = pubKey

    this.onInvalidKey = onInvalidKey
    this.shouldAnnounce = shouldAnnounce
    this.swarmInterface = swarmInterface

    this.isTornDown = false

    this._core = null
    this._secondaryCore = null
    this._children = new Map()
  }

  get corestore () {
    return this.swarmInterface.corestore
  }

  get isSetup () {
    return this._core !== null
  }

  async setup () {
    if (this.isSetup) throw new Error('Already setup')
    if (this.tornDown) throw new Error('Torn down')

    this._core = this.corestore.get({ ...OPTS_TO_AUTO_UPDATE, key: this.pubKey })
    await this._core.ready()

    // DEVNOTE: it is possible that teardown (with unswarming) is called before
    // the swarming. This race-condition is handled by allowing the swarm-interface
    // to go negative (so would go to 0->-1->0 instead of 0->1->0)
    this._swarmOwnCore()

    // Rec logic applies only when this core is a hyperbee
    // This is known only after the core has length at least 1
    if (this._core.length > 0) {
      await this._setupRecursiveLogic()
    } else {
      this._core.once('append', async () => {
        await this._setupRecursiveLogic()
      })
    }
  }

  _swarmOwnCore () {
    if (this.shouldAnnounce) {
      this.swarmInterface.serveCore(this._core.discoveryKey)
    } else {
      this.swarmInterface.requestCore(this._core.discoveryKey)
    }
  }

  async _setupRecursiveLogic () {
    if (this.isTornDown) return
    if (this._core.length === 0) throw new Error('Programming error--should not be called when core.length 0')

    if (!(await Hyperbee.isHyperbee(this._core))) return

    const bee = new Hyperbee(this._core)

    const promises = []

    // Handle secondary core (for hyperdrives and the like)
    const contentFeedKey = await getBeeContentFeed(bee)
    const hasSecondaryCore = contentFeedKey && isKey(contentFeedKey)
    if (hasSecondaryCore) {
      this.secondaryCore = this._createNode(contentFeedKey, { shouldAnnounce: false })
      const secCorePromise = this.secondaryCore.setup()
      secCorePromise.catch(safetyCatch) // Properly handler later
      promises.push(secCorePromise)
    }

    if ((await isRehoster(bee))) {
      promises.push(this._setupChildCores(bee))
    }

    await Promise.all(promises)
  }

  async _setupChildCores (bee) {
    let lastProcessedVersion = 1 // nothing processed yet

    const appendListener = debounceify(
      async () => {
        if (this.isTownDown) return

        const { keysToAdd, keysToRm, currentV } = await getDiff(
          { bee, lastProcessedVersion }
        )
        lastProcessedVersion = currentV

        const newChildren = keysToAdd.map(k => {
          try {
            return this._createNode(k)
          } catch (e) {
            safetyCatch(e)
            if (this.onInvalidKey) {
              this.onInvalidKey({ invalidKey: asBuffer(k), rehosterKey: asBuffer(this.pubKey) })
            }
            return null
          }
        }).filter(c => c !== null)

        await Promise.all(newChildren.map(c => c.setup()))
        newChildren.forEach(c => this._children.set(asHex(c.pubKey), c))

        keysToRm.forEach(k => {
          k = asHex(k)
          // Note: can be unpresent in _children if it was an invalid key
          this._children.get(k)?.tearDown()
          this._children.delete(k)
        })
      }
    )

    // Handle future entries
    // Note: errors are swallowed (async event handler), which is annoying for debugging (TODO: rethink)
    bee.feed.on('append', () => appendListener().catch(safetyCatch))

    // Handle current entries
    await appendListener().catch(safetyCatch)
  }

  _createNode (pubKey, opts = {}) {
    return new RehosterNode({
      pubKey,
      swarmInterface: this.swarmInterface,
      onInvalidKey: this.onInvalidKey,
      ...opts
    })
  }

  tearDown () {
    if (this.isTornDown) return

    this._core.removeAllListeners('append')

    if (this.shouldAnnounce) {
      this.swarmInterface.unserveCore(this._core.discoveryKey)
    } else {
      this.swarmInterface.unrequestCore(this._core.discoveryKey)
    }

    this.secondaryCore?.tearDown()

    for (const child of this._children?.values() || []) {
      child.tearDown()
    }

    this.isTornDown = true
  }
}

async function getDiff ({ bee, lastProcessedVersion }) {
  if (lastProcessedVersion >= bee.version) {
    return { currentV: lastProcessedVersion, keysToAdd: [], keysToRm: [] }
  }

  const currentV = bee.version
  const diffStream = bee.createDiffStream(lastProcessedVersion, currentV)
  const keysToAdd = []
  const keysToRm = []

  for await (const { left: addedEntry, right: removedEntry } of diffStream) {
    if (addedEntry && !removedEntry) {
      keysToAdd.push(addedEntry.key)
    } else if (!addedEntry && removedEntry) {
      keysToRm.push(removedEntry.key)
    } else {
      console.warn(
        'Value corresponding to disc key',
        asHex(addedEntry.key),
        'changed. This type of functionality is not yet supported (ignoring)'
      )
    }
  }

  return { currentV, keysToAdd, keysToRm }
}

async function getBeeContentFeed (bee) {
  const header = await bee.getHeader()
  return header.metadata?.contentFeed
}
