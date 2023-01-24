const { expect } = require('chai')
const b4a = require('b4a')
const { hyperInterfaceFactory, testnetFactory } = require('./fixtures.js')
const RehosterNode = require('../lib/rehoster-node.js')
const { asHex, getDiscoveryKey } = require('hexkey-utils')
const Hyperdrive = require('hyperdrive')
const { ensureIsRehoster } = require('../lib/utils.js')

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

  it('Setup only hosts core itself if not a hyperbee', async function () {
    const core = await hyperInterface.createCore('testcore')
    const node = new RehosterNode({ pubKey: core.key, swarmInterface })
    await node.setup()
    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [asHex(core.discoveryKey)]
    )
  })

  it('Setup hosts all children if the hyperbee is a rehoster', async function () {
    await bee.put(key2)
    await bee.put(key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.setup()

    expect(swarmInterface.servedDiscoveryKeys).to.deep.have.same.members(
      [bee.feed.discoveryKey, getDiscoveryKey(key2), getDiscoveryKey(key)].map(k => asHex(k))
    )
  })

  it('Setup adds a handler which processes additional bee entries added later', async function () {
    await bee.put(key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.setup()

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

  it('makes a hyperdrive contentKey available, but without announcing', async function () {
    const drive = new Hyperdrive(swarmInterface.corestore)
    await drive.put('/file', 'something')
    await bee.put(drive.key)

    const node = new RehosterNode({ pubKey: bee.feed.key, swarmInterface })
    await node.setup()

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
    await node.setup()

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
})
