import { expect } from 'chai'
import { spy as _spy } from 'sinon'
import ram from 'random-access-memory'

import { getDiscoveryKey } from 'hexkey-utils'
import Corestore from 'corestore'

import Rehoster from '../index.js'
import { testnetFactory } from './fixtures.js'

describe('Rehoster tests', function () {
  let testnet
  let rehoster
  let initNrCores

  this.beforeEach(async function () {
    const corestore = new Corestore(ram)
    const corestore2 = new Corestore(ram)

    testnet = await testnetFactory(
      corestore,
      corestore2
    )

    rehoster = await Rehoster.initFrom({
      beeName: 'keystoreBee',
      corestore,
      swarm: testnet.swarmInterface1.swarm
    })

    initNrCores = rehoster.hypercoreInterface.corestore.cores.size
  })

  this.afterEach(async function () {
    await rehoster.close()
    await testnet.destroy()
  })

  it('Can sync an empty db', async function () {
    await rehoster.syncWithDb()
    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(initNrCores)
    expect(rehoster.servedDiscoveryKeys.length).to.equal(0)
  })

  it('Can add a core', async function () {
    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(initNrCores + 1)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(core.key)])
  })

  it('Does not error if adding a key a second time', async function () {
    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)
    await rehoster.addCore(core.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(
      initNrCores + 1
    )
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(core.key)])
  })

  it('Can add multiple cores with addCore', async function () {
    const spy = _spy(rehoster, 'syncWithDb')

    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)
    const core2 = await rehoster.hypercoreInterface.createHypercore('my core2')
    await rehoster.addCore(core2.key)

    expect(new Set(rehoster.servedDiscoveryKeys)).to.deep.equal(new Set([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key)
    ]))
    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(
      initNrCores + 2
    )

    expect(spy.callCount).to.equal(2)
  })

  it('Can add multiple cores with addCores', async function () {
    const spy = _spy(rehoster, 'syncWithDb')

    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    const core2 = await rehoster.hypercoreInterface.createHypercore('my core2')

    await rehoster.addCores([core.key, core2.key])

    expect(new Set(rehoster.servedDiscoveryKeys)).to.deep.equal(new Set([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key)
    ]))
    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(
      initNrCores + 2
    )
    expect(spy.callCount).to.equal(1)
  })

  // integration test, which connects with swarm
  // it('Runs the example without crashing (takes~30s)', async function () {
  //   await util.promisify(execFile)('node', ['./example.js'])
  // })
})
