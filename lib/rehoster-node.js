const safetyCatch = require('safety-catch')
const Hyperbee = require('hyperbee')
const { validateKey, isKey, asHex, asBuffer } = require('hexkey-utils')
const ReadyResource = require('ready-resource')

const { isRehoster } = require('./utils.js')

const OPTS_TO_AUTO_UPDATE = { sparse: false }
Object.freeze(OPTS_TO_AUTO_UPDATE)

class RehosterNode extends ReadyResource {
  constructor ({
    pubKey,
    swarmInterface,
    parentKeys = new Set(),
    shouldAnnounce = true,
    onInvalidKey = undefined
  }) {
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

    this._settingUpChildLogic = null
  }

  get corestore () {
    return this.swarmInterface.corestore
  }

  async _open () {
    this._core = this.corestore.get({
      ...OPTS_TO_AUTO_UPDATE,
      key: this.pubKey
    })
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

    // Handle secondary core (for hyperdrives and the like)
    const contentFeedKey = await getBeeContentFeed(bee)
    const hasSecondaryCore = contentFeedKey && isKey(contentFeedKey)
    if (hasSecondaryCore) {
      this.secondaryCore = this._createNode(
        contentFeedKey,
        { shouldAnnounce: false }
      )
      await this.secondaryCore.ready()
    }

    if ((await isRehoster(bee))) {
      this._watcher = bee.watch()
      const initDiffs = bee.createDiffStream(1)

      await this._consumeDiffStream(initDiffs)

      // Watch for later diffs
      // TODO: handle error case
      this._runWatcher().catch(safetyCatch)
    }
  }

  async _consumeDiffStream (diffStream) {
    for await (const { left: addedEntry, right: removedEntry } of diffStream) {
      if (addedEntry && !removedEntry) {
        const key = addedEntry.key
        try {
          if (!this.parentKeys.has(asHex(key))) {
            const newChild = this._createNode(key)
            await newChild.ready()
            this._children.set(asHex(newChild.pubKey), newChild)
          }
        } catch (e) {
          safetyCatch(e)
          if (this.onInvalidKey) {
            this.onInvalidKey({
              invalidKey: asBuffer(key),
              rehosterKey: asBuffer(this.pubKey)
            })
          }
        }
      } else if (!addedEntry && removedEntry) {
        const key = asHex(removedEntry.key)
        await this._children.get(key)?.close()
        this._children.delete(key)
      } else {
        if (removedEntry.value !== addedEntry.value) {
          console.warn(
            'Value corresponding to disc key',
            asHex(addedEntry.key),
            'changed. This type of functionality is not yet supported (ignoring)'
          )
        }
      }
    }
  }

  async _runWatcher () {
    for await (const [current, previous] of this._watcher) {
      const diffStream = current.createDiffStream(previous.version)
      await this._consumeDiffStream(diffStream)
    }
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

    if (this._watcher) {
      const destroyProm = this._watcher.destroy()
      await this._consumeWatcherProm // potential last remaining yields
      await destroyProm
    }

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

async function getBeeContentFeed (bee) {
  const header = await bee.getHeader()
  return header.metadata?.contentFeed
}

module.exports = RehosterNode
