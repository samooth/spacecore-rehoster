const ReadyResource = require('ready-resource')
const idEnc = require('hypercore-id-encoding')
const RehosterDb = require('./db')
const NodeManager = require('./lib/node-manager')

class Rehoster extends ReadyResource {
  constructor (corestore, swarmManager, bee, { shouldRehost = alwaysRehost } = {}) {
    super()

    this.swarmManager = swarmManager
    this.corestore = corestore

    this.db = new RehosterDb(bee)
    this.rootNode = null
    this.nodeManager = new NodeManager(
      this.swarmManager,
      this.corestore, {
        shouldRehost,
        onInvalidKey: ({ publicKey, invalidKey }) => {
          this.emit('invalid-key', { publicKey, invalidKey })
        },
        onInvalidValue: ({ publicKey, rawEntry, error }) => {
          this.emit('invalid-value', { publicKey, rawEntry, error })
        },
        onNewNode: (rehosterNodeRef, nrRefs) => {
          this.emit(
            'new-node',
            new RehosterNodeRefInfo(rehosterNodeRef, nrRefs)
          )
        },
        onNodeDeleted: (rehosterNodeRef, nrRefs) => {
          this.emit(
            'deleted-node',
            new RehosterNodeRefInfo(rehosterNodeRef, nrRefs)
          )
        },
        // Only these 2 are emitted by the nodes themselves
        onNodeUpdate: (rehosterNode) => {
          this.emit(
            'node-update',
            new RehosterNodeInfo(rehosterNode)
          )
        },
        onFullyDownloaded: (rehosterNode) => {
          this.emit(
            'node-fully-downloaded',
            new RehosterNodeInfo(rehosterNode)
          )
        }
      }
    )
    this.nodeManager.on('error', (err) => this.emit('error', err))
  }

  get bee () {
    return this.db.bee
  }

  get swarm () {
    return this.swarmManager.swarm
  }

  get ownKey () {
    return this.bee.core.key
  }

  get ownDiscoveryKey () {
    return this.bee.core.discoveryKey
  }

  async _open () {
    await this.bee.ready()
    await this.nodeManager.ready()

    this.rootNode = this.nodeManager.addNode(this.ownKey, {
      description: 'Rehoster root node'
    })

    await this.rootNode.ready()
  }

  async _close () {
    await this.nodeManager.close()
    await this.corestore.close()
  }

  async add (key, { description, ...opts } = {}) {
    await this.ready()
    return await this.db.add(key, { description, ...opts })
  }

  async get (key) {
    await this.ready()
    return await this.db.get(key)
  }

  async has (key) {
    await this.ready()
    return await this.db.has(key)
  }

  async delete (key) {
    await this.ready()
    return await this.db.delete(key)
  }

  // WARNING: The sync method should NOT be used in combination
  // with the add and del methods: no care is taken to avoid
  // race conditions against add and delete operations while
  // a sync is running (only against other syncs)
  async sync (desiredState) {
    await this.ready()
    const syncedIt = await this.db.sync(desiredState)
    if (syncedIt) this.emit('synced', desiredState)
  }

  createReadStream () {
    return this.db.createReadStream()
  }

  async getExplicitEntries () {
    const versionInfo = false

    const res = []
    for await (const { key, value } of this.createReadStream()) {
      if (!versionInfo) {
        delete value.major
        delete value.minor
      }
      res.push([key, value])
    }

    return res
  }

  registerLogger (logger) {
    this.on('new-node', ({ description, nrRefs, coreLength, publicKey }) => {
      logger.info(`New node added: '${description}' (ref ${nrRefs} for ${idEnc.normalize(publicKey)} with current length: ${coreLength})`)
    })
    this.on('deleted-node', ({ description, nrRefs, publicKey }) => {
      logger.info(`Node deleted: '${description}' (${idEnc.normalize(publicKey)} has ${nrRefs} refs remaining)`)
    })

    this.on('node-update', ({ publicKey, coreLength }) => {
      logger.info(`Length updated to ${coreLength} for ${idEnc.normalize(publicKey)}`)
    })
    this.on('node-fully-downloaded', ({ publicKey, coreLength }) => {
      logger.info(`Node ${idEnc.normalize(publicKey)} is fully downloaded (total length: ${coreLength})`)
    })

    this.on('invalid-key', ({ publicKey, invalidKey }) => {
      logger.info(`Ignored invalid key for rehoster ${idEnc.normalize(publicKey)} (key ${invalidKey})`)
    })
    this.on('invalid-value', ({ publicKey, rawEntry, error }) => {
      const key = rawEntry.key
      logger.info(`Invalid entry for rehoster ${idEnc.normalize(publicKey)} at key ${key}`)
      if (logger?.level === 'debug') logger.debug(error.stack)
    })
  }
}

class RehosterNodeRefInfo {
  constructor (rehosterNodeRef, nrRefs) {
    this.nrRefs = nrRefs
    this.publicKey = rehosterNodeRef.pubKey
    this.coreLength = rehosterNodeRef.core.length
    this.description = rehosterNodeRef.description
  }
}

class RehosterNodeInfo {
  constructor (rehosterNode) {
    this.publicKey = rehosterNode.pubKey
    this.coreLength = rehosterNode.core.length
  }
}

function alwaysRehost () {
  return true
}

module.exports = Rehoster
