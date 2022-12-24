
import { strict as nodeAssert } from 'assert'

import { expect } from 'chai'
import { dbInterfaceFactory, hyperInterfaceFactory } from './fixtures.js'
import DbInterface from '../lib/db-interface.js'

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

  it('Throws when initing with bee with incorrect encoding', async function () {
    const hyperInterface = await hyperInterfaceFactory()
    const bee = await hyperInterface.createHyperbee('bee', { keyEncoding: 'utf-8' })
    expect(() => new DbInterface(bee)).to.throw(
      'DbInterface must have default (binary) keyEncoding'
    )
  })
})
