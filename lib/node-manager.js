const idEnc = require('hypercore-id-encoding')
const RehosterNode = require('./rehoster-node')
const safetyCatch = require('safety-catch')
const ReadyResource = require('ready-resource')

class RehosterNodeManager extends ReadyResource {
  // DEVNOTE on design:
  // One RehosterNodeManager exists per Rehoster
  // All new nodes are added through that object
  // Its responsibilities are:
  // - Ensure only a single RehosterNode exists per public key
  //   => keys which are present multiple times, have 1 RehosterNode but multiple RehosterNodeRefs
  //      (This is crucial for avoiding infinite loops when 2 rehosters rehost each other)
  // - Ensure correct ref counting, and close a RehosterNode when it has 0 refs
  // - Correctly manage the swarmManager (which does the swarm ref counting for serving/joining)

  constructor (swarmManager, corestore, {
    onNodeDeleted,
    onNewNode,
    onNodeUpdate,
    onFullyDownloaded,
    onInvalidKey,
    onInvalidValue
  }) {
    super()

    this.swarmManager = swarmManager
    this.corestore = corestore
    this.onNodeDeleted = onNodeDeleted
    this.onNewNode = onNewNode
    this.onNodeUpdate = onNodeUpdate
    this.onFullyDownloaded = onFullyDownloaded
    this.onInvalidKey = onInvalidKey
    this.onInvalidValue = onInvalidValue

    this.nodes = new Map()
  }

  async _open () {
    await this.swarmManager.ready()
  }

  async _close () {
    await this.swarmManager.close()

    const closeProms = []
    for (const { node } of this.nodes.values()) {
      closeProms.push(node.close())
    }

    await Promise.allSettled(closeProms)
  }

  _getNodeEntry (pubKey) {
    return this.nodes.get(idEnc.normalize(pubKey))
  }

  _setNodeEntry (pubKey, entry) {
    return this.nodes.set(idEnc.normalize(pubKey), entry)
  }

  _deleteNodeEntry (pubKey) {
    this.nodes.delete(idEnc.normalize(pubKey))
  }

  addNode (pubKey, { description, shouldAnnounce = true }) {
    if (this.closing) return

    let nodeEntry = this._getNodeEntry(pubKey)
    if (!nodeEntry) {
      const node = new RehosterNode({
        nodeManager: this,
        pubKey,
        corestore: this.corestore,
        onInvalidKey: this.onInvalidKey,
        onInvalidValue: this.onInvalidValue,
        onNodeUpdate: this.onNodeUpdate,
        onFullyDownloaded: this.onFullyDownloaded
      })
      node.on('error', err => {
        this.emit('error', err)
      })
      nodeEntry = { node, refs: 0 }
      this._setNodeEntry(pubKey, nodeEntry)
    }

    nodeEntry.refs++
    const nodeRef = new RehosterNodeRef(nodeEntry.node, this, {
      description,
      shouldAnnounce
    })

    nodeRef.once('ready', () => this.onNewNode(nodeRef, nodeEntry.refs))

    return nodeRef
  }

  // Only RehosterNodeRefs are allowed to call this method
  _removeNode (rehosterNodeRef) {
    if (this.closing) return

    const pubKey = rehosterNodeRef.node.pubKey
    const nodeEntry = this._getNodeEntry(rehosterNodeRef.pubKey)
    nodeEntry.refs--
    if (nodeEntry.refs <= 0) {
      this._deleteNodeEntry(pubKey)
      nodeEntry.node.close()
        .then(() => this.onNodeDeleted(rehosterNodeRef, nodeEntry.refs))
        .catch(safetyCatch)
    } else {
      this.onNodeDeleted(rehosterNodeRef, nodeEntry.refs)
    }
  }
}

class RehosterNodeRef extends ReadyResource {
  constructor (node, nodeManager, { description, shouldAnnounce }) {
    super()
    this.node = node
    this.nodeManager = nodeManager
    this.shouldAnnounce = shouldAnnounce
    this.description = description
  }

  get pubKey () {
    return this.node.pubKey
  }

  get core () {
    return this.node.core
  }

  get discoveryKey () {
    return this.core.discoveryKey
  }

  get swarmManager () {
    return this.nodeManager.swarmManager
  }

  async _open () {
    await this.node.ready()
    this._swarmOwnCore()
  }

  async _close () {
    if (this.shouldAnnounce) {
      await this.swarmManager.unserve(this.discoveryKey)
    } else {
      await this.swarmManager.unrequest(this.discoveryKey)
    }

    this.nodeManager._removeNode(this)
  }

  _swarmOwnCore () {
    if (this.shouldAnnounce) {
      this.swarmManager.serve(this.discoveryKey)
    } else {
      this.swarmManager.request(this.discoveryKey)
    }
  }
}

module.exports = RehosterNodeManager
