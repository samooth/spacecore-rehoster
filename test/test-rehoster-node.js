const { expect } = require('chai')
const b4a = require('b4a')
const { hyperInterfaceFactory, testnetFactory } = require('./fixtures.js')
const RehosterNode = require('../lib/rehoster-node.js')
const { asHex, getDiscoveryKey } = require('hexkey-utils')
const Hyperdrive = require('hyperdrive')
const { ensureIsRehoster, isRehoster } = require('../lib/utils.js')
const { once } = require('events')

describe('RehosterNode tests', function () {
  let bee
  let swarmInterface, swarmInterface2
  let hyperInterface, hyperInterface2
  let testnet

  const key = b4a.from('a'.repeat(64), 'hex')
  const key2 = b4a.from('b'.repeat(64), 'hex')
  const key3 = b4a.from('c'.repeat(64), 'hex')

  this.beforeEach(async function () {
    hyperInterface = await hyperInterfaceFactory()
    hyperInterface2 = await hyperInterfaceFactory()

    testnet = await testnetFactory(
      hyperInterface.corestore,
      hyperInterface2.corestore
    )

    swarmInterface2 = testnet.swarmInterface2
    swarmInterface = testnet.swarmInterface1

    bee = await hyperInterface.createBee('testbee')
    await ensureIsRehoster(bee) // Adds correct header
  })

  this.afterEach(async function () {
    await testnet.destroy()
    await Promise.all([hyperInterface.close(), hyperInterface2.close()])
  })

  it('Throws on invalid pubKey', function () {
    expect(() => new RehosterNode({ pubKey: 'nope' })).to.throw('Invalid key: nope--should match')
  })

  it('Ready only hosts core itself if not a hyperbee', async function () {
    const core = await hyperInterface.createCore('testcore')
    const node = new RehosterNode({ pubKey: core.key, swarmInterface })
    await node.ready()
    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [asHex(core.discoveryKey)]
    )
  })

  it('Ready hosts all children if the hyperbee is a rehoster', async function () {
    await bee.put(key2)
    await bee.put(key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, getDiscoveryKey(key2), getDiscoveryKey(key)].map(k => asHex(k))
    )
  })

  it('Ready adds a handler which processes additional bee entries added later', async function () {
    await bee.put(key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, getDiscoveryKey(key)].map(k => asHex(k))
    )

    await bee.put(key2)
    await new Promise((resolve) => setTimeout(resolve, 1)) // Unsure if always sufficient time
    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, getDiscoveryKey(key), getDiscoveryKey(key2)].map(k => asHex(k))
    )

    await bee.put(key3)
    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [asHex(bee.feed.discoveryKey), getDiscoveryKey(key), getDiscoveryKey(key2), getDiscoveryKey(key3)]
    )
  })

  it('processes entries in dedicated bee sub', async function () {
    bee = await hyperInterface.createBee('normalBee')
    await bee.put('some', 'thing')
    expect(await isRehoster(bee)).to.equal(false)

    const sub = bee.sub('\x00\x00\x00rehoster_key')
    await sub.put(key)

    const node = new RehosterNode({ pubKey: bee.core.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, getDiscoveryKey(key)].map(k => asHex(k))
    )

    // Also those added later
    await sub.put(key2)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members([
      bee.feed.discoveryKey,
      getDiscoveryKey(key),
      getDiscoveryKey(key2)
    ].map(k => asHex(k)))
  })

  it('makes a hyperdrive contentKey available, but without announcing', async function () {
    const drive = new Hyperdrive(swarmInterface.corestore.namespace('drive'))
    await drive.put('/file', 'something')
    await bee.put(drive.key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, drive.discoveryKey].map(k => asHex(k))
    )

    expect(swarmInterface.replicatedDiscoveryKeys).to.deep.have.same.members(
      [
        bee.feed.discoveryKey, drive.discoveryKey, getDiscoveryKey(drive.contentKey)
      ].map(k => asHex(k))
    )
  })

  it('Also processes keys it cannot find, and connects to + downloads them when they come online', async function () {
    const core = await hyperInterface.createCore('my core')
    await core.append('something') // Needs at least 1 entry before bee-logic processed
    await bee.put(core.key)

    const unavailableCore = await hyperInterface2.createCore('somecore')
    unavailableCore.append('offline entry')
    await bee.put(unavailableCore.key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      asHex(bee.feed.discoveryKey),
      getDiscoveryKey(unavailableCore.key)
    ])

    const readCore = await hyperInterface.readCore(
      unavailableCore.key, { valueEncoding: 'utf-8' }
    )

    // Sanity check: ensure not yet available
    let entry
    readCore.get(0)
      .then((content) => { entry = content })
      .catch((err) => { throw err })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(entry).to.eq(undefined)

    await swarmInterface.swarm.flush() // To avoid race conditions
    await swarmInterface2.serveCore(unavailableCore.discoveryKey)
    await swarmInterface2.swarm.flush()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(entry).to.eq('offline entry')
    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      asHex(bee.feed.discoveryKey),
      getDiscoveryKey(unavailableCore.key)
    ])
  })

  it('Can close immediately after calling ready', async function () {
    await bee.put(key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    node.ready().catch(e => { throw e })
    await node.close()

    expect(swarmInterface.servedDiscoveryKeys.length).to.equal(0)
    expect(node.closed).to.eq(true)
  })

  it('Recursively closes child nodes', async function () {
    const drive = new Hyperdrive(swarmInterface.corestore.namespace('drive'))
    await drive.put('/file', 'something')
    await bee.put(drive.key)
    await bee.put(key)

    const otherBee = await hyperInterface.createBee('other bee')
    await ensureIsRehoster(otherBee)
    await otherBee.put(bee.feed.key)

    const node = new RehosterNode({ pubKey: otherBee.feed.key, swarmInterface })
    await node.ready()

    expect(swarmInterface.replicatedDiscoveryKeys).to.deep.have.same.members([
      bee.feed.discoveryKey,
      otherBee.feed.discoveryKey,
      getDiscoveryKey(key),
      drive.discoveryKey,
      getDiscoveryKey(drive.contentKey)
    ].map(k => asHex(k)))

    const allSubNodes = _getAllSubNodes(node)
    expect(allSubNodes.length).to.eq(1 + 2 + 1) // the bee, its 2 kids (key and drive.key) and the drive's kid
    expect(allSubNodes.filter(c => c.closed).length).to.equal(0)

    await node.close()
    expect(allSubNodes.filter(c => c.closed).length).to.equal(allSubNodes.length)
    expect(swarmInterface.replicatedDiscoveryKeys.length).to.equal(0)
  })

  it('No race-condition on close when running recursive logic in background', async function () {
    await bee.put(key)

    const otherBee = await hyperInterface2.createBee('other bee')
    await ensureIsRehoster(otherBee)
    await otherBee.put(bee.feed.key)

    const node = new RehosterNode({ pubKey: otherBee.feed.key, swarmInterface: swarmInterface2 })
    await node.ready()

    expect(_getAllSubNodes(node).length).to.eq(2) // own (otherBee's) key + bee's key

    const readCore = node.corestore.get({ key: bee.feed.key })
    await readCore.ready()

    const areConnected = once(readCore, 'append')

    await node.swarmInterface.swarm.flush() // Avoid race conditions on swarming
    await swarmInterface.serveCore(bee.feed.discoveryKey)

    await areConnected
    // The change is propagating, but bee's child is not yet added
    expect(_getAllSubNodes(node).length).to.eq(2)

    await node.close()

    const nodes = _getAllSubNodes(node)
    expect(nodes.length).to.eq(3) // change was propagated--bee's child added

    expect(nodes.filter(c => c.closed).length).to.equal(nodes.length)
    expect(swarmInterface2.replicatedDiscoveryKeys.length).to.eq(0)
  })
})

function _getAllSubNodes (rehosterNode) {
  const res = [rehosterNode]
  rehosterNode.children?.forEach((c) => res.push(..._getAllSubNodes(c)))

  return res
}
