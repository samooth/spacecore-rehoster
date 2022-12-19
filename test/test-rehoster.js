const { expect } = require('chai')
const sinon = require('sinon')
const ram = require('random-access-memory')

const Rehoster = require('..')
const { getDiscoveryKey } = require('hexkey-utils')

const { testnetFactory } = require('./fixtures')
const Corestore = require('corestore')

describe('Rehoster tests', function () {
  let testnet
  let rehoster

  this.beforeEach(async function () {
    const corestore = new Corestore(ram)
    const corestore2 = new Corestore(ram)

    testnet = await testnetFactory(
      corestore,
      corestore2
    )

    rehoster = await Rehoster.initFrom(
      { dbConnectionStr: ':memory:', corestore, swarm: testnet.swarmInterface1.swarm }
    )
  })

  this.afterEach(async function () {
    await Promise.all([rehoster.close(), testnet.destroy()])
  })

  it('Can sync an empty db', async function () {
    await rehoster.syncWithDb()
    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(0)
    expect(rehoster.servedDiscoveryKeys.length).to.equal(0)
  })

  it('Can add a core', async function () {
    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(1)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(core.key)])
  })

  it('Does nothing if adding a key a second time', async function () {
    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)
    await rehoster.addCore(core.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(1)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(core.key)])
  })

  it('Can add multiple cores with addCore', async function () {
    const spy = sinon.spy(rehoster, 'syncWithDb')

    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)
    const core2 = await rehoster.hypercoreInterface.createHypercore('my core2')
    await rehoster.addCore(core2.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(2)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key)
    ])
    expect(spy.callCount).to.equal(2)
  })

  it('Can add multiple cores with addCores', async function () {
    const spy = sinon.spy(rehoster, 'syncWithDb')

    const core = await rehoster.hypercoreInterface.createHypercore('my core')
    const core2 = await rehoster.hypercoreInterface.createHypercore('my core2')

    await rehoster.addCores([core.key, core2.key])

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(2)
    expect(rehoster.servedDiscoveryKeys).to.deep.equal([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key)
    ])
    expect(spy.callCount).to.equal(1)
  })
})
