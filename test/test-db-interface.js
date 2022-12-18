const { expect } = require('chai')
const { dbInterfaceFactory } = require('./fixtures')

describe('Db-interface tests', function () {
  let dbInterface
  let key

  this.beforeEach(function () {
    dbInterface = dbInterfaceFactory()
    key = 'a'.repeat(64)
  })

  it('Can add a key to the db', function () {
    dbInterface.addHexKey(key)

    const hexKeys = dbInterface.getHexKeys()
    expect(hexKeys).to.deep.equal(new Set([key]))
  })

  it('throws when adding same key twice', function () {
    dbInterface.addHexKey(key)
    expect(() =>
      dbInterface.addHexKey(key)
    ).to.throw('UNIQUE constraint failed: core.hexKey')
  })

  it('throws when adding invalid key', function () {
    const badKey = key.slice(0, 63)
    expect(() =>
      dbInterface.addHexKey(badKey)
    ).to.throw(`Invalid hexKey: ${badKey}--should match /[0-9a-f]{64,64}`)
  })

  it('Can get the keys', function () {
    const key2 = 'b'.repeat(64)
    const key3 = 'c'.repeat(64)
    dbInterface.addHexKey(key)
    dbInterface.addHexKey(key2)
    dbInterface.addHexKey(key3)

    const keys = dbInterface.getHexKeys()
    expect(keys).to.deep.equal(new Set([key, key2, key3]))
  })
})
