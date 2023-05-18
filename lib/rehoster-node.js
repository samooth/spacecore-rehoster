const safetyCatch = require('safety-catch')
const Hyperbee = require('hyperbee')
const { validateKey, isKey, asHex, asBuffer } = require('hexkey-utils')
const ReadyResource = require('ready-resource')
const SubEncoder = require('sub-encoder')

const { METADATA_SUB } = require('./constants')
const { isRehoster } = require('./utils.js')

const OPTS_TO_AUTO_UPDATE = { sparse: false }

class RehosterNode extends ReadyResource {
  constructor ({
    pubKey,
    swarmManager,
    parentKeys = new Set(),
    shouldAnnounce = true,
    onInvalidKey = undefined
  }) {
    super()

    validateKey(pubKey)
    this.pubKey = pubKey

    this.onInvalidKey = onInvalidKey
    this.shouldAnnounce = shouldAnnounce
    this.swarmManager = swarmManager
    this.parentKeys = new Set([...parentKeys, asHex(this.pubKey)])

    this.core = null
    this.secondaryCore = null
    this.children = null

    this._settingUpChildLogic = null
  }

  get corestore () {
    return this.swarmManager.store
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
      this._setupRecursiveLogic().catch(err => {
        this.emit('error', err)
      })
    }
  }

  _swarmOwnCore () {
    if (this.shouldAnnounce) {
      this.swarmManager.serve(this.core.discoveryKey)
    } else {
      this.swarmManager.request(this.core.discoveryKey)
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
      this.secondaryCore.on('error', err => {
        this.emit('error', err)
      })
      await this.secondaryCore.ready()
    }

    let diffOpts = {}
    if ((await isRehoster(bee))) {
      this._watcher = bee.watch()
      const initDiffs = bee.createDiffStream(1)

      await this._consumeDiffStream(initDiffs)
    } else {
      const subEnc = (new SubEncoder()).sub(METADATA_SUB)
      // DEVNOTE: we are not passing the keyEncoding as that
      // is not yet supported by watch. But, it is instead
      // set as an option to the diffStream, indirectly
      // through the subEncoding.range() function.
      // I am not sure that would work with non-binary encodings
      // but we are using binary, so seems fine for now.
      this._watcher = bee.watch(
        subEnc.range() // , { keyEncoding: subEnc } // TODO: this instead of the diffStream workaround?
      )

      diffOpts = subEnc.range()
      const initDiffs = bee.createDiffStream(1, diffOpts)
      await this._consumeDiffStream(initDiffs)
    }
    // Watch for later diffs
    this._runWatcher(diffOpts).catch(err => {
      this.emit('error', err)
    })
  }

  _addChild (child) {
    // TODO: cleanly handle case where child was already added
    child.on('error', (err) => { this.emit('error', err) })
    this.children.set(asHex(child.pubKey), child)
  }

  async _consumeDiffStream (diffStream) {
    for await (const { left, right } of diffStream) {
      const addedEntry = left
      const removedEntry = right

      if (addedEntry && !removedEntry) {
        const key = addedEntry.key
        try {
          if (!this.parentKeys.has(asHex(key))) {
            const newChild = this._createNode(key)
            this._addChild(newChild)
            // TODO: consider awaiting all ready's at once
            await newChild.ready()
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
        const entry = this.children.get(key)
        this.children.delete(key)
        // TODO: consider safety catch instead of emit
        entry?.close().catch((err) => this.emit('error', err))
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

  async _runWatcher (opts) {
    for await (const [current, previous] of this._watcher) {
      const diffStream = current.createDiffStream(previous.version, opts)
      await this._consumeDiffStream(diffStream)
    }
  }

  _createNode (pubKey, opts = {}) {
    return new RehosterNode({
      pubKey,
      swarmManager: this.swarmManager,
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
      await this.swarmManager.unserve(this.core.discoveryKey)
    } else {
      await this.swarmManager.unrequest(this.core.discoveryKey)
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
