const { strict: nodeAssert } = require('assert')
const { expect } = require('chai')

const { dbInterfaceFactory, hyperInterfaceFactory } = require('./fixtures.js')
const DbInterface = require('../lib/db-interface.js')

describe('Db-interface tests', function () {
  let dbInterface
  let key

  this.beforeEach(async function () {
    dbInterface = await dbInterfaceFactory()
    key = 'a'.repeat(64)
  })

  it('Can add a key to the db', async function () {
    await dbInterface.addKey(key)

    const hexKeys = await dbInterface.getHexKeys()
    expect(hexKeys).to.deep.equal([key])
  })

  it('Can remove a key from the db', async function () {
    await dbInterface.addKey(key)
    expect(await dbInterface.getHexKeys()).to.deep.equal([key])

    await dbInterface.removeKey(key)
    expect(await dbInterface.getHexKeys()).to.deep.equal([])
  })

  it('Does nothing when removing unknown key', async function () {
    await dbInterface.addKey(key)
    expect(await dbInterface.getHexKeys()).to.deep.equal([key])

    await dbInterface.removeKey('bbb')
    expect(await dbInterface.getHexKeys()).to.deep.equal([key])
  })

  it('throws when adding invalid key', async function () {
    const badKey = key.slice(0, 63)
    await nodeAssert.rejects(
      dbInterface.addKey(badKey),
      new RegExp(`Invalid key: ${badKey}--`)
    )
  })

  it('Can get the keys', async function () {
    const key2 = 'b'.repeat(64)
    const key3 = 'c'.repeat(64)
    await dbInterface.addKey(key)
    await dbInterface.addKey(key2)
    await dbInterface.addKey(key3)

    const keys = await dbInterface.getHexKeys()
    expect(new Set(keys)).to.deep.equal(new Set([key, key2, key3]))
  })

  it('Throws on ready if bee has incorrect encoding', async function () {
    const hyperInterface = await hyperInterfaceFactory()
    const bee = await hyperInterface.createBee('bee', { keyEncoding: 'utf-8' })
    const int = new DbInterface(bee)
    await nodeAssert.rejects(
      int.ready(),
      'DbInterface must have default (binary) keyEncoding'
    )
  })
})
