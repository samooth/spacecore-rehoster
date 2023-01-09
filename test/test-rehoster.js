import { expect } from 'chai'
import { spy as _spy } from 'sinon'
import ram from 'random-access-memory'

import { getDiscoveryKey, asHex } from 'hexkey-utils'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'

import Rehoster from '../index.js'
import { testnetFactory } from './fixtures.js'
import HyperInterface from 'hyperpubee-hyper-interface'

describe('Rehoster tests', function () {
  let testnet
  let rehoster
  let initNrCores
  let corestore, corestore2, swarm
  let hyperInterface2, swarmInterface2

  this.beforeEach(async function () {
    corestore = new Corestore(ram)
    corestore2 = new Corestore(ram)

    testnet = await testnetFactory(
      corestore,
      corestore2
    )

    swarmInterface2 = testnet.swarmInterface2
    hyperInterface2 = new HyperInterface(corestore2)

    swarm = testnet.swarmInterface1.swarm

    rehoster = await Rehoster.initFrom({
      beeName: 'keystoreBee',
      corestore,
      swarm
    })

    initNrCores = rehoster.hyperInterface.corestore.cores.size
  })

  this.afterEach(async function () {
    await rehoster.close()
    await testnet.destroy()
  })

  it('Can sync an empty db', async function () {
    await rehoster.syncWithDb()
    expect(rehoster.hyperInterface.corestore.cores.size).to.equal(initNrCores)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(rehoster.ownKey)])
  })

  it('Can add a core', async function () {
    const core = await rehoster.hyperInterface.createCore('my core')
    await rehoster.addCore(core.key)

    expect(rehoster.hyperInterface.corestore.cores.size).to.equal(initNrCores + 1)
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(core.key), getDiscoveryKey(rehoster.ownKey)]
    )
  })

  it('Does not error if adding a key a second time', async function () {
    const core = await rehoster.hyperInterface.createCore('my core')
    await rehoster.addCore(core.key)
    await rehoster.addCore(core.key)

    expect(rehoster.hyperInterface.corestore.cores.size).to.equal(initNrCores + 1)
    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members(
      [getDiscoveryKey(core.key), getDiscoveryKey(rehoster.ownKey)]
    )
  })

  it('Can add multiple cores with addCore', async function () {
    const spy = _spy(rehoster, 'syncWithDb')

    const core = await rehoster.hyperInterface.createCore('my core')
    await rehoster.addCore(core.key)
    const core2 = await rehoster.hyperInterface.createCore('my core2')
    await rehoster.addCore(core2.key)

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key),
      getDiscoveryKey(rehoster.ownKey)
    ])
    expect(rehoster.hyperInterface.corestore.cores.size).to.equal(
      initNrCores + 2
    )

    expect(spy.callCount).to.equal(2)
  })

  it('Can add multiple cores with addCores', async function () {
    const spy = _spy(rehoster, 'syncWithDb')

    const core = await rehoster.hyperInterface.createCore('my core')
    const core2 = await rehoster.hyperInterface.createCore('my core2')

    await rehoster.addCores([core.key, core2.key])

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key),
      getDiscoveryKey(rehoster.ownKey)
    ])
    expect(rehoster.hyperInterface.corestore.cores.size).to.equal(
      initNrCores + 2
    )
    expect(spy.callCount).to.equal(1)
  })

  it('Follows recursion in a RecRehoster', async function () {
    const recCore = await rehoster.hyperInterface.createCore('rec core')
    const recCore2 = await rehoster.hyperInterface.createCore('rec core2')
    await rehoster.addCores([recCore.key, recCore2.key])

    const recRehoster = await Rehoster.initFrom({
      beeName: 'rehoster2',
      corestore,
      swarm
    })
    const core = await rehoster.hyperInterface.createCore('my core')
    await recRehoster.addCores([core.key, rehoster.ownKey])

    expect(recRehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(recCore.key),
      getDiscoveryKey(recCore2.key),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(core.key),
      getDiscoveryKey(recRehoster.ownKey)
    ])
  })

  it('works across different swarms', async function () {
    const recCore = await rehoster.hyperInterface.createCore('rec core')
    const recCore2 = await rehoster.hyperInterface.createCore('rec core2')
    await rehoster.addCores([recCore.key, recCore2.key])

    const recRehoster = await Rehoster.initFrom({
      beeName: 'rehoster2',
      corestore: corestore2,
      swarm: testnet.swarmInterface2.swarm
    })
    const core = await recRehoster.hyperInterface.createCore('my core')
    await recRehoster.addCores([core.key, rehoster.ownKey])

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
    const core = await hyperInterface2.createCore('my core')
    await core.append('block0')
    await swarmInterface2.serveCore(core.discoveryKey)

    await rehoster.addCore(core.key)
    const readCore = await rehoster.hyperInterface.readCore(core.key)
    expect(readCore.length).to.equal(1)

    await core.append('block1')

    // Give time to update (0ms might be sufficient, but not sure)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(readCore.length).to.equal(2)
  })

  it('makes a hyperdrive contentKey available, but without announcing', async function () {
    const drive = new Hyperdrive(corestore)
    await drive.put('/file', 'something')
    await rehoster.addCore(drive.key)

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey)
    ])
    expect(rehoster.replicatedDiscoveryKeys).to.deep.have.same.members([
      asHex(drive.discoveryKey),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(drive.contentKey)
    ])
  })

  it('Also processes keys it cannot find, and connects to + downloads them when they come online', async function () {
    // DEVNOTE: if the unavailable key is a rehoster, only the rehoster itself will be rehosted,
    // but not the keys it contains (until another sync is triggered)
    const core = await rehoster.hyperInterface.createCore('my core')
    await rehoster.addCore(core.key)
    const unavailableCore = await hyperInterface2.createCore('somecore')
    await unavailableCore.append('offline entry')
    await rehoster.addCore(unavailableCore.key)

    expect(rehoster.servedDiscoveryKeys).to.deep.have.same.members([
      getDiscoveryKey(core.key),
      getDiscoveryKey(rehoster.ownKey),
      getDiscoveryKey(unavailableCore.key)
    ])

    const readCore = await rehoster.hyperInterface.readCore(
      unavailableCore.key, { valueEncoding: 'utf-8' }
    )

    let entry
    readCore.get(0)
      .then((content) => { entry = content })
      .catch((err) => { throw err })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(entry).to.eq(undefined)

    await swarmInterface2.serveCore(unavailableCore.discoveryKey)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(entry).to.eq('offline entry')
  })

  // integration test, which connects with swarm
  // it('Runs the example without crashing (takes~30s)', async function () {
  //   await util.promisify(execFile)('node', ['./example.js'])
  // })
})
