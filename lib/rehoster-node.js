const safetyCatch = require('safety-catch')
const Hyperbee = require('hyperbee')
const { validateKey, isKey, asHex, asBuffer } = require('hexkey-utils')
const ReadyResource = require('ready-resource')

const { METADATA_SUB } = require('./constants')
const { isRehoster } = require('./utils.js')

const OPTS_TO_AUTO_UPDATE = { sparse: false }

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

    this.core = null
    this.secondaryCore = null
    this.children = null

    this._settingUpChildLogic = null
  }

  get corestore () {
    return this.swarmInterface.corestore
  }

  async _open () {
    this.core = this.corestore.get({
      ...OPTS_TO_AUTO_UPDATE,
      key: this.pubKey
    })
    await this.core.ready()

    this._swarmOwnCore()

    await this._setupRecursiveLogic({ wait: false })

    if (!this.children) {
      // Still not known whether it's a bee--set up in background
      this._setupRecursiveLogic().catch(
        err => this.emit('error', err)
      )
    }
  }

  _swarmOwnCore () {
    if (this.shouldAnnounce) {
      this.swarmInterface.serveCore(this.core.discoveryKey)
    } else {
      this.swarmInterface.requestCore(this.core.discoveryKey)
    }
  }

  async _setupRecursiveLogic ({ wait = true } = {}) {
    let isBee
    try {
      isBee = await Hyperbee.isHyperbee(this.core, { wait })
    } catch (e) { // Could not load first block (~only when opts.wait=false set)
      safetyCatch(e)
      return
    }

    if (this.closing) return

    this.children = new Map()
    if (!isBee) return

    this._settingUpChildLogic = this._setupChildLogic()
    await this._settingUpChildLogic
    this._settingUpChildLogic = null
  }

  async _setupChildLogic () {
    const bee = new Hyperbee(this.core)

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
    } else {
      const sub = bee.sub(METADATA_SUB)
      this._watcher = sub.watch()
      const initDiffs = sub.createDiffStream(1)

      await this._consumeDiffStream(initDiffs)
    }
    // Watch for later diffs
    this._runWatcher().catch(err => this.emit('error', err))
  }

  _addChild (child) {
    child.on('error', (err) => this.emit('error', err))
    this.children.set(asHex(child.pubKey), child)
  }

  async _consumeDiffStream (diffStream) {
    for await (const { left: addedEntry, right: removedEntry } of diffStream) {
      if (addedEntry && !removedEntry) {
        const key = addedEntry.key
        try {
          if (!this.parentKeys.has(asHex(key))) {
            const newChild = this._createNode(key)
            await newChild.ready()
            this._addChild(newChild)
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
        await this.children.get(key)?.close()
        this.children.delete(key)
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
      await this.swarmInterface.unserveCore(this.core.discoveryKey)
    } else {
      await this.swarmInterface.unrequestCore(this.core.discoveryKey)
    }

    const proms = []
    if (this.secondaryCore) proms.push(this.secondaryCore.close())

    for (const child of this.children?.values() || []) {
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
