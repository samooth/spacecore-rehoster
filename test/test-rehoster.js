const { expect } = require('chai')

const Rehoster = require('..')
const { getDiscoveryKey } = require('hexkey-utils')

const { dbInterfaceFactory, testnetFactory, hyperInterfaceFactory } = require('./fixtures')

describe('Rehoster tests', function () {
  let dbInterface, testnet, hypercoreInterface, hypercoreInterface2
  let rehoster

  this.beforeEach(async function () {
    dbInterface = dbInterfaceFactory()
    hypercoreInterface = await hyperInterfaceFactory()
    hypercoreInterface2 = await hyperInterfaceFactory()

    testnet = await testnetFactory(
      hypercoreInterface.corestore,
      hypercoreInterface2.corestore
    )

    rehoster = new Rehoster({ dbInterface, hypercoreInterface, swarmInterface: testnet.swarmInterface1 })
  })

  this.afterEach(async function () {
    await Promise.all([rehoster.close(), testnet.destroy()])
  })

  it('Can sync an empty db', async function () {
    await rehoster.syncWithDb()
    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(0)
    expect(rehoster.swarmInterface.servedDiscoveryKeys.length).to.equal(0)
  })

  it('Can add a core', async function () {
    const core = await hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(1)
    expect(rehoster.swarmInterface.servedDiscoveryKeys).to.deep.equal([getDiscoveryKey(core.key)])
  })

  it('Can add multiple cores', async function () {
    const core = await hypercoreInterface.createHypercore('my core')
    await rehoster.addCore(core.key)
    const core2 = await hypercoreInterface.createHypercore('my core2')
    await rehoster.addCore(core2.key)

    expect(rehoster.hypercoreInterface.corestore.cores.size).to.equal(2)
    expect(rehoster.swarmInterface.servedDiscoveryKeys).to.deep.equal([
      getDiscoveryKey(core.key),
      getDiscoveryKey(core2.key)
    ])
  })
})
