const { strict: nodeAssert } = require('assert')
const { expect } = require('chai')
const ram = require('random-access-memory')
const sinon = require('sinon')
const { asHex, asBuffer, getDiscoveryKey } = require('hexkey-utils')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const Hyperdrive = require('hyperdrive')
const { discoveryKey } = require('hypercore-crypto')
const Rehoster = require('../index.js')
const { testnetFactory } = require('./fixtures.js')
const SwarmManager = require('swarm-manager')

describe('Rehoster tests', function () {
  let testnet
  let rehoster
  let initNrCores
  let corestore, corestore2
  let swarmManager2
  let swarmManager
  let core
  let swarm

  this.beforeEach(async function () {
    corestore = new Corestore(ram)
    corestore2 = new Corestore(ram)

    testnet = await testnetFactory(
      corestore,
      corestore2
    )

    swarmManager2 = testnet.swarmManager2
    swarmManager = testnet.swarmManager1

    swarm = testnet.swarmManager1.swarm
    const bee = new Hyperbee(corestore.get({ name: 'mybee' }))
    await bee.ready()

    rehoster = new Rehoster(corestore, swarmManager)
    await rehoster.ready()

    initNrCores = rehoster.corestore.cores.size

    core = corestore.get({ name: 'my core' })
    await core.ready()
  })

  this.afterEach(async function () {
    await rehoster.close()
    await testnet.destroy()
  })

  it('sets the value of the root node', async function () {
    expect(rehoster.rootNode.info).to.equal(
      'The rehoster itself'
    )
  })

  it('Can add a core', async function () {
    await rehoster.add(core.key)

    expect(corestore.cores.size).to.equal(initNrCores + 1)

    // Give time for async update to catch up
    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(core.key), discoveryKey(rehoster.ownKey)]
    )

    expect((await rehoster.get(core.key)).value).to.equal(null)
  })

  it('Can add a core with a value', async function () {
    await rehoster.add(
      core.key,
      { info: 'I am info', somethingElse: 'I am a core' },
      { valueEncoding: 'json' }
    )

    // Give time for async update to catch up
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(core.key), discoveryKey(rehoster.ownKey)]
    )

    const node = rehoster.rootNode.children.get(asHex(core.key))
    expect(node.info).to.deep.equal('I am info')
    expect((await rehoster.get(core.key)).value).to.deep.equal(
      { info: 'I am info', somethingElse: 'I am a core' }
    )
  })

  it('Does not error if adding a key a second time', async function () {
    await rehoster.add(core.key)
    await rehoster.add(core.key)

    expect(corestore.cores.size).to.equal(initNrCores + 1)

    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(core.key), discoveryKey(rehoster.ownKey)]
    )

    await rehoster.delete(core.key) // Ensure added only once
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(rehoster.ownKey)]
    )
  })

  it('Can add multiple cores', async function () {
    await rehoster.add(core.key)
    const core2 = corestore.get({ name: 'my core2' })
    await core2.ready()
    await rehoster.add(core2.key)

    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(core.key),
      discoveryKey(core2.key),
      discoveryKey(rehoster.ownKey)
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

    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(rehoster.ownKey), discoveryKey(core.key)]
    )
    expect(detectedInvalidKey.toString()).to.deep.equal('Not a hypercore key')
    expect(detectedRehosterKey).to.deep.equal(asBuffer(rehoster.ownKey))

    // Sanity check: later deleting the key doesn't cause issues
    await rehoster.dbInterface.bee.del(txt)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(rehoster.ownKey), discoveryKey(core.key)]
    )
  })

  it('Can host a rehoster with bee on another corestore/swarm', async function () {
    await rehoster.add(core.key)
    const replicatedBee = new Hyperbee(corestore2.get({ key: rehoster.bee.feed.key }))
    await replicatedBee.ready()

    await rehoster.swarmManager.serve(rehoster.bee.feed.discoveryKey)
    await rehoster.swarmManager.swarm.flush()

    await swarmManager2.request(discoveryKey(rehoster.ownKey))
    const readRehoster = new Rehoster(corestore, swarmManager2)
    await readRehoster.ready()

    expect(rehoster.servedKeys).to.deep.have.same.members(
      [discoveryKey(readRehoster.ownKey), discoveryKey(core.key)]
    )

    await readRehoster.close()
  })

  it('Errors on invalid rehoster from other corestore/swarm', async function () {
    const aBee = new Hyperbee(corestore.get({ name: 'some core' }))
    await aBee.put('not a rehoster')

    const replicatedBee = new Hyperbee(corestore2.get({ key: aBee.feed.key }))
    await replicatedBee.ready()

    await rehoster.swarmManager.serve(aBee.feed.discoveryKey)
    await rehoster.swarmManager.swarm.flush()

    await swarmManager2.request(discoveryKey(rehoster.ownKey))
    const readRehoster = new Rehoster(corestore2, swarmManager2, { bee: aBee })
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
    await rehoster.swarmManager.swarm.flush()

    const superCore = corestore2.get({ name: 'bee2-core' })
    const superBee = new Hyperbee(superCore)
    await superBee.ready()

    const recRehoster = new Rehoster(corestore2, swarmManager2)

    await recRehoster.add(core.key)
    await recRehoster.add(rehoster.ownKey)

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(recRehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(recCore.key),
      discoveryKey(recCore2.key),
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key),
      discoveryKey(recRehoster.ownKey)
    ])

    await recRehoster.close()
  })

  it('auto updates if one of the seeded cores updates', async function () {
    await core.append('block0')
    await swarmManager2.serve(core.discoveryKey)
    await swarmManager2.swarm.flush()

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

    expect(rehoster.servedKeys).to.deep.have.same.members([
      drive.discoveryKey,
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key)
    ])
    expect(rehoster.keys).to.deep.have.same.members([
      drive.discoveryKey,
      discoveryKey(rehoster.ownKey),
      discoveryKey(drive.contentKey),
      discoveryKey(core.key)
    ])

    await rehoster.delete(drive.key)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key)
    ])
    expect(rehoster.keys).to.deep.have.same.members([
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key)
    ])
  })

  it('Does not delete keys which change from requested to served', async function () {
    const drive = new Hyperdrive(corestore)
    await drive.put('/file', 'something')

    await rehoster.add(drive.key)
    await rehoster.add(core.key)

    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedKeys).to.deep.have.same.members([
      drive.discoveryKey,
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key)
    ])
    expect(rehoster.keys).to.deep.have.same.members([
      drive.discoveryKey,
      discoveryKey(rehoster.ownKey),
      discoveryKey(drive.contentKey),
      discoveryKey(core.key)
    ])

    // Rm drive's main key while content key explicitly hosted
    await rehoster.add(drive.contentKey)

    await rehoster.delete(drive.key, { sync: false })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key),
      discoveryKey(drive.contentKey)
    ])
    expect(rehoster.keys).to.deep.have.same.members([
      discoveryKey(rehoster.ownKey),
      discoveryKey(core.key),
      discoveryKey(drive.contentKey)
    ])
  })

  it('Can remove a core', async function () {
    await rehoster.add(core.key)
    await new Promise((resolve) => setTimeout(resolve, 1))

    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(core.key),
      discoveryKey(rehoster.ownKey)
    ])
    expect((await rehoster.dbInterface.getHexKeys()).length).to.eq(1)

    await rehoster.delete(core.key)
    expect((await rehoster.dbInterface.getHexKeys()).length).to.eq(0)

    // Stopped announcing it too
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(rehoster.ownKey)
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

      const superCore = corestore2.get({ name: 'bee2-core' })
      superBee = new Hyperbee(superCore, { valueEncoding: 'json' })
      await superBee.ready()

      recRehoster = new Rehoster(corestore2, swarmManager2, { bee: superBee })
      await rehoster.swarm.flush()
    })

    it('Follows recursion in a RecRehoster', async function () {
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      await wait(100)

      expect(recRehoster.servedKeys).to.deep.have.same.members([
        discoveryKey(recCore.key),
        discoveryKey(recCore2.key),
        discoveryKey(rehoster.ownKey),
        discoveryKey(core.key),
        discoveryKey(recRehoster.ownKey)
      ])
    })

    it('Emits error if a child errors', async function () {
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      await wait(100)

      // Mock the runWatcher method so it crashes on the next diff
      const stub = sinon.stub(recRehoster.rootNode.children.get(asHex(rehoster.ownKey)), '_consumeDiffStream')
      stub.throws(new Error('Unexpected error while consuming watcher'))
      await rehoster.add('a'.repeat(64))

      let error = null
      recRehoster.on('error', (err) => { error = err })
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(error?.message).to.equal('Unexpected error while consuming watcher')
    })

    it('Emits error if a child errors (emitted error)', async function () {
      recRehoster.on('new-node', () => {
        throw new Error('oops, I messed up my handler')
      })

      let error = null
      recRehoster.on('error', (err) => { error = err })
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      await wait(100)

      expect(error?.message).to.equal('oops, I messed up my handler')
    })

    it('Emits a new-node event', async function () {
      let addedKey = null
      let addedLength = null

      recRehoster.on('new-node', ({ publicKey, length }) => {
        addedKey = publicKey
        addedLength = length
      })

      await recRehoster.add(core.key)

      await wait(100)

      expect(addedKey).to.deep.equal(core.key)
      expect(addedLength).to.equal(0)
    })

    it('Emits a node-update event', async function () {
      let addedKey = null
      let newLength = null

      recRehoster.on('node-update', ({ publicKey, length }) => {
        addedKey = publicKey
        newLength = length
      })

      await recRehoster.add(core.key)

      await wait(100)

      expect(addedKey).to.deep.equal(recRehoster.ownKey)
      expect(newLength).to.equal(2) // init block and the added key
    })

    it('Recursively removes cores', async function () {
      await recRehoster.add(core.key)
      await recRehoster.add(rehoster.ownKey)

      const superCore = corestore.get({ name: 'Core for superrehoster' })
      const bee3 = new Hyperbee(superCore, { valueEncoding: 'json' })

      // Note: this reuses the swarm for a new SwarmManager,
      // which is ugly, but it's an easy hack here
      const superMgr = new SwarmManager(swarm)
      const superRehoster = new Rehoster(corestore, superMgr, { bee: bee3 })
      await superRehoster.add(recRehoster.ownKey)

      await wait(100)

      expect(superRehoster.servedKeys).to.deep.have.same.members([
        discoveryKey(recCore.key),
        discoveryKey(recCore2.key),
        discoveryKey(rehoster.ownKey),
        discoveryKey(core.key),
        discoveryKey(recRehoster.ownKey),
        discoveryKey(superRehoster.ownKey)
      ])

      await recRehoster.delete(rehoster.ownKey)
      await wait(100)

      expect(superRehoster.servedKeys).to.deep.have.same.members([
        discoveryKey(core.key),
        discoveryKey(recRehoster.ownKey),
        discoveryKey(superRehoster.ownKey)
      ])

      await superRehoster.close()
    })

    it('Does not recurse eternally', async function () {
      // Note: if this test fails it runs forever in the background, so test doesn't finish
      await rehoster.add(rehoster.ownKey)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(rehoster.swarmManager._servedCounters.get(getDiscoveryKey(rehoster.ownKey))).to.equal(1)
    })

    it('Removes a core hosted twice only when removed in both places', async function () {
      await recRehoster.add(rehoster.ownKey)
      await recRehoster.add(core.key)
      await rehoster.add(core.key) // Added twice now

      await wait(100)

      expect(recRehoster.swarmManager._servedCounters.get(getDiscoveryKey(core.key))).to.equal(2)

      await recRehoster.delete(core.key)
      await wait(100)
      expect(recRehoster.swarmManager._servedCounters.get(getDiscoveryKey(core.key))).to.equal(1)

      await rehoster.delete(core.key)
      await wait(100)
      expect(recRehoster.swarmManager._servedCounters.get(getDiscoveryKey(core.key))).to.equal(0)
      expect(recRehoster.swarmManager.servedKeys).to.deep.have.same.members([
        discoveryKey(recRehoster.ownKey),
        discoveryKey(rehoster.ownKey),
        discoveryKey(recCore.key),
        discoveryKey(recCore2.key)
      ])
    })
  })

  it('exports the rehoster sub name', function () {
    expect(Rehoster.SUB).to.equal('\x00\x00\x00rehoster_key')
  })

  it('can sync against json data', async function () {
    const core2 = corestore.get({ name: 'core2' })
    await core2.ready()

    await rehoster.sync({
      [asHex(core.key)]: { info: 'I am info' },
      [asHex(core2.key)]: { info: 'I am info' }
    })

    // Give time for async update to catch up
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(rehoster.servedKeys).to.deep.have.same.members([
      discoveryKey(core.key),
      discoveryKey(core2.key),
      discoveryKey(rehoster.ownKey)
    ])
  })
})

async function wait (ms = 100) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
