const safetyCatch = require('safety-catch')
const Spacebee = require('spacebee')
const { validateKey, isKey, asBuffer } = require('hexkey-utils')
const ReadyResource = require('ready-resource')
const detectType = require('spacecore-detector')
const idEnc = require('spacecore-id-encoding')
const cenc = require('compact-encoding')

const { REHOSTER_SUB, RehosterValueEnc } = require('./encodings')

class RehosterNode extends ReadyResource {
  constructor ({
    nodeManager,
    pubKey,
    corestore,
    shouldRehost,
    shouldAnnounce = true,
    onNodeUpdate,
    onFullyDownloaded,
    onInvalidKey,
    onInvalidValue
  }) {
    super()

    validateKey(pubKey)
    this.pubKey = pubKey

    this.shouldRehost = shouldRehost
    this.nodeManager = nodeManager

    this.onInvalidKey = onInvalidKey
    this.onNodeUpdate = onNodeUpdate
    this.onInvalidValue = onInvalidValue
    this.onFullyDownloaded = onFullyDownloaded
    this.shouldAnnounce = shouldAnnounce

    this.corestore = corestore

    this.core = null
    this.secondaryCore = null
    this.children = null

    this._settingUpChildLogic = null
  }

  async _open () {
    this.core = this.corestore.get({ key: this.pubKey })
    this.core.on('append', () => {
      this.onNodeUpdate(this)
    })
    this.core.on('download', (index) => {
      const fullyDownloaded = this.core.contiguousLength === this.core.length
      if (fullyDownloaded) {
        this.onFullyDownloaded(this)
      }
    })

    this.core.download({ start: 0, end: -1 }) // Sync continuously (until the core is closed)
    await this.core.ready()

    await this._setupRecursiveLogic({ wait: false })
    if (!this.children) {
      // Still not known whether it's a bee--set up in background
      this._setupRecursiveLogic().catch(err => {
        this.emit('error', err)
      })
    }
  }

  async _setupRecursiveLogic ({ wait = true } = {}) {
    if (this.closing) return

    const type = await detectType(this.core, { wait })
    if (this.closing) return

    if (type === null) return // ~only possible when wait=false set

    this.children = new Map()
    if (type === 'core') return

    this._settingUpChildLogic = this._setupChildLogic()
    await this._settingUpChildLogic
    this._settingUpChildLogic = null
  }

  async _setupChildLogic () {
    if (this.closing) return

    const bee = new Spacebee(this.core)
    await bee.ready()

    if (this.closing) return

    // Handle secondary core (for spacedrives and the like)
    const contentFeedKey = await getBeeContentFeed(bee)
    if (this.closing) return

    const hasSecondaryCore = contentFeedKey && isKey(contentFeedKey)
    if (hasSecondaryCore) {
      const description = `Secondary core of ${idEnc.normalize(this.pubKey)}`
      this.secondaryCore = this.nodeManager.addNode(
        contentFeedKey,
        {
          shouldAnnounce: false,
          description
        }
      )

      // Backgrounded, because we could (in theory) deadlock
      // while awaiting ready, if the secondary core is itself
      // a rehoster referring back to us
      this.secondaryCore.ready().catch(err => {
        this.emit('error', err)
      })
    }

    // DEVNOTE: it's important that the watching run in the
    // background. In particular, consuming the initial diff
    // MUST run in the background, otherwise 2 rehosters rehosting
    // each other can end up deadlocked, waiting on each other's ready forever
    this._runDiffWatcher(bee).catch(err => {
      // DEVNOTE: there might be a clean way to close the diff watcher,
      // but for now it can throw due to SESSION_CLOSED errors.
      // This doesn't matter during closing, so we just ignore them
      if (!this.closing) this.emit('error', err.stack)
    })
  }

  _addChild (child) {
    this.children.set(idEnc.normalize(child.pubKey), child)
  }

  async _consumeDiffStream (diffStream) {
    if (this.closing) return

    for await (const { left, right } of diffStream) {
      if (this.closing) return

      const addedEntry = left ? { key: left.key } : null
      const removedEntry = right ? { key: right.key } : null

      // Skip invalid keys
      // Note: Removing an invalid key is fine
      if (addedEntry && !idEnc.isValid(addedEntry.key)) {
        this.onInvalidKey({
          publicKey: this.pubKey,
          invalidKey: asBuffer(addedEntry.key)
        })
        continue
      }

      // DEVNOTE: We cannot decode the value during the stream,
      // because then the entire stream errors in case of error (like version mismatch)
      try {
        // Note: we only check the value of added entries
        // since for removed ones it's irrelevant
        if (addedEntry) {
          addedEntry.value = cenc.decode(RehosterValueEnc, left.value)
        }
      } catch (e) {
        this.onInvalidValue({ publicKey: this.pubKey, rawEntry: left, error: e })
        continue
      }

      try {
        if (addedEntry && !this.shouldRehost(addedEntry)) continue
      } catch (e) {
        safetyCatch(e)
        this.emit('error', e)
      }

      try {
        if (addedEntry && !removedEntry) {
          const key = addedEntry.key
          const newChild = this.nodeManager.addNode(key, {
            description: addedEntry.value.description
          })
          this._addChild(newChild)
          // TODO: consider awaiting all ready's at once
          await newChild.ready()
        } else if (!addedEntry && removedEntry) {
          const nodeRef = this.children.get(idEnc.normalize(removedEntry.key))
          // Note: could not exist (for example if removing an entry with a bad value)
          this.children.delete(removedEntry.key)
          nodeRef?.close().catch((err) => this.emit('error', err))
        } else {
          const nodeRef = this.children.get(idEnc.normalize(removedEntry.key))
          if (nodeRef) nodeRef.description = addedEntry.description
          // TODO: handle else (e.g. when an invalid entry is replaced by a new one)
          // Possible solution: set null entry for removedEntry when we detect it's an invalid value
        }
      } catch (e) {
        safetyCatch(e)
        this.emit('error', e)
      }

      if (this.closing) return
    }
  }

  async _runDiffWatcher (bee) {
    if (this.closing) return

    const opts = { keyEncoding: REHOSTER_SUB }
    this._watcher = bee.watch({}, opts)

    const initDiffs = bee.createDiffStream(1, opts)
    await this._consumeDiffStream(initDiffs)

    if (this.closing) return

    for await (const [current, previous] of this._watcher) {
      if (this.closing) return

      const diffStream = current.createDiffStream(previous.version, opts)
      await this._consumeDiffStream(diffStream)
      if (this.closing) return
    }
  }

  async _close () {
    if (this._watcher) {
      const destroyProm = this._watcher.destroy()
      destroyProm.catch(safetyCatch)
      await this._consumeWatcherProm // potential last remaining yields
      await destroyProm
    }

    const proms = [this.core.close()]
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
