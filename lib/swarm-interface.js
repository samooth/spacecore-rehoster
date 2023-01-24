const { asBuffer, asHex } = require('hexkey-utils')
const Hyperswarm = require('hyperswarm')

class SwarmInterface {
  constructor (swarm, corestore) {
    this.swarm = swarm || new Hyperswarm()
    this.corestore = corestore
    this._servedCounters = new Map()
    this._replicatedCounters = new Map()
    this.setupReplication()
  }

  setupReplication () {
    this.swarm.on('connection', (socket) => {
      this.corestore.replicate(socket)
      socket.on('error', (err) => {
        console.error('socket error:', err.stack)
        socket.destroy()
      })
    })

    this.swarm.on('error', (e) => {
      console.error('swarm error:', e)
    })
  }

  serveCore (discoveryKey) {
    const key = asHex(discoveryKey)
    const prev = this._servedCounters.get(key) || 0
    this._servedCounters.set(key, prev + 1)

    if (prev === 0) {
      this.swarm.join(asBuffer(discoveryKey), { server: true, client: true })
    }
  }

  unserveCore (discoveryKey) {
    const key = asHex(discoveryKey)
    const prev = this._servedCounters.get(key) || 0

    this._replicatedCounters.set(key, prev - 1)

    if (prev === 1) {
      this.swarm.leave(asBuffer(discoveryKey))
      // TODO: check if this can be done in one operation/simpler
      if (this._replicatedCounters.get(key) > 0) { // Still replicated
        this.swarm.join(asBuffer(discoveryKey), { server: false, client: true })
      }
    }
  }

  requestCore (discoveryKey) {
    const key = asHex(discoveryKey)
    const prev = this._replicatedCounters.get(key) || 0
    this._replicatedCounters.set(key, prev + 1)

    const nrServed = this._servedCounters.get(key) || 0
    if (prev === 0 && nrServed === 0) { // serving includes requesting
      this.swarm.join(asBuffer(discoveryKey), { server: false, client: true })
    }
  }

  unrequestCore (discoveryKey) {
    const key = asHex(discoveryKey)
    const prev = this._replicatedCounters.get(key) || 0

    this._replicatedCounters.set(key, prev + 1)

    const nrServed = this._servedCounters.get(key) || 0
    if (nrServed === 0) {
      this.swarm.leave(asBuffer(discoveryKey))
    }
  }

  get replicatedDiscoveryKeys () {
    const topicObjs = this.swarm.topics()

    const res = Array.from(topicObjs)
      .filter((topicObj) => topicObj.isClient)
      .map((topicObj) => asHex(topicObj.topic))

    return res
  }

  get servedDiscoveryKeys () {
    const topicObjs = this.swarm.topics()

    const res = Array.from(topicObjs)
      .filter((topicObj) => topicObj.isServer)
      .map((topicObj) => asHex(topicObj.topic))

    return res
  }

  async close () {
    for (const conn of this.swarm.connections) {
      conn.end()
    }
    await this.swarm.destroy()
    this.swarm.removeAllListeners()
  }
}

module.exports = SwarmInterface
