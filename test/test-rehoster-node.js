
import { expect } from 'chai'
import b4a from 'b4a'
import { hyperInterfaceFactory } from './fixtures.js'
import RehosterNode from '../lib/rehoster-node.js'

describe('RehosterNode tests', function () {
  let hyperInterface
  let bee

  const key = b4a.from('a'.repeat(64), 'hex')
  const key2 = b4a.from('b'.repeat(64), 'hex')

  this.beforeEach(async function () {
    hyperInterface = await hyperInterfaceFactory()
    bee = await hyperInterface.createBee('testbee')
  })

  this.afterEach(async function () {
    await hyperInterface.close()
  })

  it('Throws on invalid pubKey', function () {
    expect(() => new RehosterNode({ pubKey: 'nope' })).to.throw('Invalid key: nope--should match')
  })

  it('returns the pub key as uniqueId', function () {
    const node = new RehosterNode({ pubKey: key })
    expect(node.uniqueId).to.equal('a'.repeat(64))
  })

  it('getChildren returns empty list if not a hyperbee', async function () {
    const core = await hyperInterface.createCore('testcore')
    const node = new RehosterNode({ pubKey: core.key, hyperInterface })
    expect(await node.getChildren()).to.deep.equal([])
  })

  it('getChildren returns empty list if a hyperbee, but with non-hypercore keys', async function () {
    await bee.put(key)
    await bee.put('Not a hypercore key')

    const node = new RehosterNode({ pubKey: bee.feed.key, hyperInterface })
    expect(await node.getChildren()).to.deep.equal([])
  })

  it('getChildren returns all entries if all are hypercore keys', async function () {
    await bee.put(key)
    await bee.put(key2)

    const node = new RehosterNode({ pubKey: bee.feed.key, hyperInterface })
    const children = await node.getChildren()
    expect(children.map((c) => c.pubKey)).to.deep.have.same.members([key, key2])
  })
})
