const { strict: nodeAssert } = require('assert')
const { expect } = require('chai')

const { dbInterfaceFactory, hyperInterfaceFactory } = require('./fixtures.js')
const DbInterface = require('../lib/db-interface.js')
const { asZBase32 } = require('hexkey-utils')

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

  it('Does not add the same key twice, except if different value', async function () {
    await dbInterface.addKey(key)
    const initLength = dbInterface.bee.version
    await dbInterface.addKey(key)
    expect(initLength).to.equal(dbInterface.bee.version)

    await dbInterface.addKey(key, 'A value')
    expect(initLength + 1).to.equal(dbInterface.bee.version)

    await dbInterface.addKey(key, 'A value')
    expect(initLength + 1).to.equal(dbInterface.bee.version)

    await dbInterface.addKey(key, 'New value')
    expect(initLength + 2).to.equal(dbInterface.bee.version)
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

  it('Can get the entry stream', async function () {
    const key2 = 'b'.repeat(64)
    const key3 = 'c'.repeat(64)
    await dbInterface.addKey(key)
    await dbInterface.addKey(key2)
    await dbInterface.addKey(key3, { info: 'my key3' })

    const entries = await consume(dbInterface.getKeyInfoStream())
    expect(new Set(entries)).to.deep.equal(new Set([{ key }, { key: key2 }, { key: key3, info: 'my key3' }]))
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

  it('can sync against a JSON', async function () {
    const key2 = 'b'.repeat(64)
    const key3 = 'c'.repeat(64)

    const initData = {
      [key]: { info: 'key1 info' },
      [key2]: { }
    }

    await dbInterface.sync(initData)
    {
      const entries = await consume(dbInterface.getKeyInfoStream())
      const expected = new Set([{ key, info: 'key1 info' }, { key: key2 }])
      expect(new Set(entries)).to.deep.equal(expected)
      expect(dbInterface.bee.version).to.equal(3)
    }

    const addData = {
      ...initData,
      [key3]: {}
    }
    await dbInterface.sync(addData)
    {
      const entries = await consume(dbInterface.getKeyInfoStream())
      const expected = new Set([
        { key, info: 'key1 info' },
        { key: key2 },
        { key: key3 }
      ])
      expect(new Set(entries)).to.deep.equal(expected)
      expect(dbInterface.bee.version).to.equal(4)
    }

    const delData = {
      [key]: { info: 'key1 info' }
    }
    await dbInterface.sync(delData)
    {
      const entries = await consume(dbInterface.getKeyInfoStream())
      const expected = new Set([
        { key, info: 'key1 info' }
      ])
      expect(new Set(entries)).to.deep.equal(expected)
      expect(dbInterface.bee.version).to.equal(6)
    }

    const updateData = {
      [key]: { info: 'key1 new info' },
      [key2]: {}

    }
    await dbInterface.sync(updateData)
    {
      const entries = await consume(dbInterface.getKeyInfoStream())
      const expected = new Set([
        { key, info: 'key1 new info' },
        { key: key2 }
      ])
      expect(new Set(entries)).to.deep.equal(expected)
      expect(dbInterface.bee.version).to.equal(8)
    }

    const z32Data = {
      [asZBase32(key)]: { info: 'key1 final info' },
      [asZBase32(key2)]: {}
    }

    await dbInterface.sync(z32Data)
    {
      const entries = await consume(dbInterface.getKeyInfoStream())
      const expected = new Set([
        { key, info: 'key1 final info' },
        { key: key2 } // unchanged
      ])
      expect(new Set(entries)).to.deep.equal(expected)
      expect(dbInterface.bee.version).to.equal(9)
    }
  })
})

async function consume (stream) {
  const entries = []
  for await (const entry of stream) {
    entries.push(entry)
  }
  return entries
}
