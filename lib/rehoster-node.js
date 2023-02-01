const safetyCatch = require('safety-catch')
const Hyperbee = require('hyperbee')
const { validateKey, isKey, asHex, asBuffer } = require('hexkey-utils')
const debounceify = require('debounceify')
const ReadyResource = require('ready-resource')

const { isRehoster } = require('./utils.js')

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

class RehosterNode extends ReadyResource {
  constructor (
    { pubKey, swarmInterface, parentKeys = new Set(), shouldAnnounce = true, onInvalidKey = undefined }
  ) {
    super()

    validateKey(pubKey)
    this.pubKey = pubKey

    this.onInvalidKey = onInvalidKey
    this.shouldAnnounce = shouldAnnounce
    this.swarmInterface = swarmInterface
    this.parentKeys = new Set([...parentKeys, asHex(this.pubKey)])

    this._core = null
    this._secondaryCore = null
    this._children = null

    this._addingChildren = null
    this._settingUpChildLogic = null
  }

  get corestore () {
    return this.swarmInterface.corestore
  }

  async _open () {
    this._core = this.corestore.get({ ...OPTS_TO_AUTO_UPDATE, key: this.pubKey })
    await this._core.ready()

    this._swarmOwnCore()

    await this._setupRecursiveLogic({ wait: false })

    if (!this._children) {
      // Still not known whether it's a bee--set up in background
      const prom = this._setupRecursiveLogic()
      prom.catch(safetyCatch)
    }
  }

  _swarmOwnCore () {
    if (this.shouldAnnounce) {
      this.swarmInterface.serveCore(this._core.discoveryKey)
    } else {
      this.swarmInterface.requestCore(this._core.discoveryKey)
    }
  }

  async _setupRecursiveLogic ({ wait = true } = {}) {
    let isBee
    try {
      isBee = await Hyperbee.isHyperbee(this._core, { wait })
    } catch (e) { // Could not load first block (~only when opts.wait=false set)
      safetyCatch(e)
      return
    }

    if (this.closing) return

    this._children = new Map()
    if (!isBee) return

    this._settingUpChildLogic = this._setupChildLogic()
    await this._settingUpChildLogic
    this._settingUpChildLogic = null
  }

  async _setupChildLogic () {
    const bee = new Hyperbee(this._core)

    const promises = []

    // Handle secondary core (for hyperdrives and the like)
    const contentFeedKey = await getBeeContentFeed(bee)
    const hasSecondaryCore = contentFeedKey && isKey(contentFeedKey)
    if (hasSecondaryCore) {
      this.secondaryCore = this._createNode(contentFeedKey, { shouldAnnounce: false })
      const secCorePromise = this.secondaryCore.ready()
      secCorePromise.catch(safetyCatch) // Properly handler later
      promises.push(secCorePromise)
    }

    if ((await isRehoster(bee))) {
      promises.push(this._setupRehosterWatcher(bee))
    }

    await Promise.all(promises)
  }

  async _setupRehosterWatcher (bee) {
    let lastProcessedVersion = 1 // nothing processed yet

    const handleNewChildren = async () => {
      const { keysToAdd, keysToRm, currentV } = await getDiff(
        { bee, lastProcessedVersion }
      )
      lastProcessedVersion = currentV

      const newChildren = keysToAdd.map(k => {
        try {
          return this.parentKeys.has(asHex(k)) ? null : this._createNode(k)
        } catch (e) {
          safetyCatch(e)
          if (this.onInvalidKey) {
            this.onInvalidKey({ invalidKey: asBuffer(k), rehosterKey: asBuffer(this.pubKey) })
          }
          return null
        }
      }).filter(c => c !== null)

      await Promise.all(newChildren.map(c => c.ready()))
      newChildren.forEach(c => this._children.set(asHex(c.pubKey), c))

      keysToRm.forEach(async (k) => {
        k = asHex(k)
        // Note: can be unpresent in _children if it was an invalid key
        await this._children.get(k)?.close()
        this._children.delete(k)
      })
    }

    const appendListener = debounceify(
      async () => {
        if (this.closing) return

        this._addingChildren = handleNewChildren()
        await this._addingChildren
        this._addingChildren = null
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
      parentKeys: new Set(this.parentKeys),
      ...opts
    })
  }

  async _close () {
    // DEVNOTE: occurs when block0 not available upon calling ready(),
    // but it became available just before close() was called
    if (this._settingUpChildLogic) await this._settingUpChildLogic

    this._core.removeAllListeners('append')
    // Finish any potential append-handler still running
    if (this._addingChildren) await this._addingChildren

    if (this.shouldAnnounce) {
      await this.swarmInterface.unserveCore(this._core.discoveryKey)
    } else {
      await this.swarmInterface.unrequestCore(this._core.discoveryKey)
    }

    const proms = []
    if (this.secondaryCore) proms.push(this.secondaryCore.close())

    for (const child of this._children?.values() || []) {
      proms.push(child.close())
    }
    await Promise.all(proms)
  }
}

async function getDiff ({ bee, lastProcessedVersion }) {
  if (lastProcessedVersion >= bee.version) {
    return { currentV: lastProcessedVersion, keysToAdd: [], keysToRm: [] }
  }
  bee = bee.snapshot() // Avoid race conditions (TODO: rm when fixed in hyperbee's diffStream)

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

module.exports = RehosterNode
