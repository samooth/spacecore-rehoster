const { strict: nodeAssert } = require('assert')
const { expect } = require('chai')
const ram = require('random-access-memory')

const { getDiscoveryKey, asHex, asBuffer } = require('hexkey-utils')
const Corestore = require('corestore')

const Rehoster = require('../index.js')
const { testnetFactory } = require('./fixtures.js')
const Hyperbee = require('hyperbee')
const Hyperdrive = require('hyperdrive')

describe('Rehoster tests', function () {
  let testnet
  let rehoster
  let initNrCores
  let corestore, corestore2, swarm
  let swarmInterface2
  let core

  this.beforeEach(async function () {
    corestore = new Corestore(ram)
    corestore2 = new Corestore(ram)

    testnet = await testnetFactory(
      corestore,
      corestore2
    )

    swarmInterface2 = testnet.swarmInterface2

    swarm = testnet.swarmInterface1.swarm

    const bee = new Hyperbee(corestore.get({ name: 'mybee' }))
    await bee.ready()

    rehoster = new Rehoster(corestore, { swarm })
    await rehoster.ready()

    initNrCores = rehoster.corestore.cores.size

    core = corestore.get({ name: 'my core' })
    await core.ready()
  })

  this.afterEach(async function () {
    await rehoster.close()
    await testnet.destroy()
  })

  it('Can add a core', async function () {
    await rehoster.add(core.key)

    expect(corestore.cores.size).to.equal(initNrCores + 1)

    // Give time for async update to catch up
    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(core.key), getDiscoveryKey(rehoster.ownKey)]
    )
  })

  it('Does not error if adding a key a second time', async function () {
    await rehoster.add(core.key)
    await rehoster.add(core.key)

    expect(corestore.cores.size).to.equal(initNrCores + 1)

    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(core.key), getDiscoveryKey(rehoster.ownKey)]
    )

    await rehoster.delete(core.key) // Ensure added only once
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(rehoster.ownKey)]
    )
  })

  it('Can add multiple cores', async function () {
    await rehoster.add(core.key)
    const core2 = corestore.get({ name: 'my core2' })
    await core2.ready()
    await rehoster.add(core2.key)

    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key),
      getDiscoveryKey(rehoster.ownKey)
    ])
    expect(corestore.cores.size).to.equal(
      initNrCores + 2
    )
  })

  it('Skips over non-hypercore keys in rehoster and emits event', async function () {
    let detectedInvalidKey, detectedRehosterKey
    rehoster.on('invalidKey', ({ invalidKey, rehosterKey }) => {
      detectedRehosterKey = rehosterKey
      detectedInvalidKey = invalidKey
    })

    const txt = 'Not a hypercore key'
    await rehoster.add(core.key)
    await rehoster.dbInterface.bee.put(txt)

    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(rehoster.ownKey), getDiscoveryKey(core.key)]
    )
    expect(detectedInvalidKey.toString()).to.deep.equal('Not a hypercore key')
    expect(detectedRehosterKey).to.deep.equal(asBuffer(rehoster.ownKey))

    // Sanity check: later deleting the key doesn't cause issues
    await rehoster.dbInterface.bee.del(txt)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(rehoster.ownKey), getDiscoveryKey(core.key)]
    )
  })

  it('Can host a rehoster with bee on another corestore/swarm', async function () {
    await rehoster.add(core.key)
    const replicatedBee = new Hyperbee(corestore2.get({ key: rehoster.bee.feed.key }))
    await replicatedBee.ready()

    await rehoster.swarmInterface.serveCore(rehoster.bee.feed.discoveryKey)
    await rehoster.swarmInterface.swarm.flush()

    await swarmInterface2.requestCore(getDiscoveryKey(rehoster.ownKey))
    const readRehoster = new Rehoster(corestore, { swarm: swarmInterface2.swarm })
    await readRehoster.ready()

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(readRehoster.ownKey), getDiscoveryKey(core.key)]
    )

    await readRehoster.close()
  })

  it('Errors on invalid rehoster from other corestore/swarm', async function () {
    const aBee = new Hyperbee(corestore.get({ name: 'some core' }))
    await aBee.put('not a rehoster')

    const replicatedBee = new Hyperbee(corestore2.get({ key: aBee.feed.key }))
    await replicatedBee.ready()

    await rehoster.swarmInterface.serveCore(aBee.feed.discoveryKey)
    await rehoster.swarmInterface.swarm.flush()

    await swarmInterface2.requestCore(getDiscoveryKey(rehoster.ownKey))
    const readRehoster = new Rehoster(corestore2, { bee: aBee, swarm: swarmInterface2.swarm })
    await nodeAssert.rejects(
      readRehoster.ready(),
      /Not a rehoster/
    )
  })

  it('works across different swarms', async function () {
    const recCore = await corestore.get({ name: 'rec core' })
    const recCore2 = await corestore.get({ name: 'rec core2' })
    await recCore.ready()
    await recCore2.ready()

    await rehoster.add(recCore.key)
    await rehoster.add(recCore2.key)

    // Avoid race conditions with announcing
    await rehoster.swarmInterface.swarm.flush()

    const superCore = corestore2.get({ name: 'bee2-core' })
    const superBee = new Hyperbee(superCore)
    await superBee.ready()

    const recRehoster = new Rehoster(corestore2, { swarm: swarmInterface2.swarm })

    await recRehoster.add(core.key)
    await recRehoster.add(rehoster.ownKey)

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(recRehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(recCore.key),
      getDiscoveryKey(recCore2.key),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key),
      getDiscoveryKey(recRehoster.ownKey)
    ])

    await recRehoster.close()
  })

  it('auto updates if one of the seeded cores updates', async function () {
    await core.append('block0')
    await swarmInterface2.serveCore(core.discoveryKey)
    await swarmInterface2.swarm.flush()

    await rehoster.add(core.key)
    const readCore = await corestore.get({ key: core.key })
    await readCore.ready()

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(readCore.length).to.equal(1)

    await core.append('block1')

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(readCore.length).to.equal(2)
  })

  it('Stops swarming the 2 drive cores if no longer in the db', async function () {
    const drive = new Hyperdrive(corestore)
    await drive.put('/file', 'something')
    await rehoster.add(drive.key)
    await rehoster.add(core.key)

    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key)
    ])
    expect(rehoster.replicatedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(drive.contentKey),
      getDiscoveryKey(core.key)
    ])

    await rehoster.delete(drive.key)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key)
    ])
    expect(rehoster.replicatedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key)
    ])
  })

  it('Does not delete keys which change from requested to served', async function () {
    const drive = new Hyperdrive(corestore)
    await drive.put('/file', 'something')

    await rehoster.add(drive.key)
    await rehoster.add(core.key)

    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key)
    ])
    expect(rehoster.replicatedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(drive.contentKey),
      getDiscoveryKey(core.key)
    ])

    // Rm drive's main key while content key explicitly hosted
    await rehoster.add(drive.contentKey)

    await rehoster.delete(drive.key, { sync: false })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key),
      getDiscoveryKey(drive.contentKey)
    ])
    expect(rehoster.replicatedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key),
      getDiscoveryKey(drive.contentKey)
    ])
  })

  it('Can remove a core', async function () {
    await rehoster.add(core.key)
    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      getDiscoveryKey(rehoster.ownKey)
    ])
    expect((await rehoster.dbInterface.getHexKeys()).length).to.eq(1)

    await rehoster.delete(core.key)
    expect((await rehoster.dbInterface.getHexKeys()).length).to.eq(0)

    // Stopped announcing it too
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(rehoster.ownKey)
    ])
  })

  describe('Recursion', function () {
    let recCore, recCore2, superBee
    let recRehoster

    this.beforeEach(async function () {
      recCore = await corestore.get({ name: 'rec core' })
      recCore2 = await corestore.get({ name: 'rec core2' })
      await recCore.ready()
      await recCore2.ready()

      await rehoster.add(recCore.key)
      await rehoster.add(recCore2.key)

      const superCore = corestore.get({ name: 'bee2-core' })
      superBee = new Hyperbee(superCore)
      await superBee.ready()

      recRehoster = new Rehoster(corestore, { bee: superBee, swarm })
    })

    it('Follows recursion in a RecRehoster', async function () {
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      await new Promise((resolve) => setTimeout(resolve, 1))

      expect(recRehoster.servedDiscoveryKeys).to.deep.have.same.members([
        getDiscoveryKey(recCore.key),
        getDiscoveryKey(recCore2.key),
        getDiscoveryKey(rehoster.ownKey),
        getDiscoveryKey(core.key),
        getDiscoveryKey(recRehoster.ownKey)
      ])
    })

    it('Recursively removes cores', async function () {
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      const superCore = corestore.get({ name: 'Core for superrehoster' })
      const bee3 = new Hyperbee(superCore)

      const superRehoster = new Rehoster(corestore, { bee: bee3, swarm })
      await superRehoster.add(recRehoster.ownKey)

      expect(superRehoster.servedDiscoveryKeys).to.deep.have.same.members([
        getDiscoveryKey(recCore.key),
        getDiscoveryKey(recCore2.key),
        getDiscoveryKey(rehoster.ownKey),
        getDiscoveryKey(core.key),
        getDiscoveryKey(recRehoster.ownKey),
        getDiscoveryKey(superRehoster.ownKey)
      ])

      await recRehoster.delete(rehoster.ownKey)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(superRehoster.servedDiscoveryKeys).to.deep.have.same.members([
        getDiscoveryKey(core.key),
        getDiscoveryKey(recRehoster.ownKey),
        getDiscoveryKey(superRehoster.ownKey)
      ])
    })

    it('Does not recurse eternally', async function () {
      // Note: if this test fails it runs forever in the background, so test doesn't finish
      await rehoster.add(rehoster.ownKey)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(rehoster.swarmInterface._servedCounters.get(getDiscoveryKey(rehoster.ownKey))).to.equal(1)
    })
  })
})
