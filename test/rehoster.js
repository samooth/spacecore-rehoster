const path = require('path')
const { spawn } = require('child_process')
const { once } = require('events')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const Corestore = require('corestore')
const RAM = require('random-access-memory')
const SwarmManager = require('swarm-manager')
const Hyperswarm = require('hyperswarm')
const { discoveryKey } = require('hypercore-crypto')
const idEnc = require('hypercore-id-encoding')
const b4a = require('b4a')
const Rehoster = require('../index')
const { REHOSTER_SUB, CURRENT_VERSION } = require('../lib/encodings')
const Hyperdrive = require('hyperdrive')
const Hyperbee = require('hyperbee')

const DEBUG = false

const EXAMPLE_LOC = path.join(path.dirname(__dirname), 'example.js')

// For test teardown order
let peerOrder = 0
let rehosterOrder = 0

// For spawned processes, to force the process.on('exit') to be called on those exits too
process.prependListener('SIGINT', () => process.exit(1))
process.prependListener('SIGTERM', () => process.exit(1))

test('Can add to rehoster', async (t) => {
  t.plan(4)

  const { bootstrap, rehoster } = await setup(t)
  const core = await setupCore(t, bootstrap)
  await rehoster.ready()

  rehoster.on('new-node', ({ publicKey }) => {
    t.alike(publicKey, core.key, 'added key')
    t.alike(
      new Set(rehoster.swarmManager.servedKeys),
      new Set([rehoster.ownDiscoveryKey, core.discoveryKey]),
      'Serves itself + the core'
    )
  })
  rehoster.on('node-fully-downloaded', ({ publicKey }) => {
    t.alike(publicKey, core.key, 'downloaded key')
  })

  await rehoster.add(core.key)
  t.is(await rehoster.has(core.key), true, 'has key after adding')
})

test('Can delete a core from the rehoster', async function (t) {
  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const core = await setupCore(t, bootstrap)

  await rehoster.add(core.key)
  await once(rehoster, 'new-node')
  t.is(await rehoster.has(core.key), true, 'sanity check')

  t.alike(
    new Set(swarmManager.servedKeys),
    new Set([discoveryKey(core.key), discoveryKey(rehoster.ownKey)]),
    'Rehosting core (sanity check)'
  )

  rehoster.delete(core.key)
  await once(rehoster, 'deleted-node')

  t.is(await rehoster.has(core.key), false, 'key deleted')

  // Stopped announcing it too
  t.alike(
    new Set(swarmManager.servedKeys),
    new Set([discoveryKey(rehoster.ownKey)]),
    'Stopped rehosting the deleted key'
  )
})

test('can sync against a key map', async (t) => {
  const tSync1 = t.test('first-sync')
  tSync1.plan(2)
  const tSync2 = t.test('second-sync')
  tSync2.plan(2)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)
  const core3 = await setupCore(t, bootstrap)

  await rehoster.ready()

  let nrAdded = 0
  let testDone = false
  rehoster.on('new-node', () => {
    if (nrAdded++ < 2) {
      tSync1.pass('added a new node')
    } else {
      tSync2.pass('added new node')
    }
  })
  rehoster.on('deleted-node', () => {
    if (!testDone) tSync2.pass('deleted the node')
  })

  {
    const syncInput = new Map()
    syncInput.set(idEnc.normalize(core.key), {})
    syncInput.set(idEnc.normalize(core2.key), {})
    rehoster.sync(syncInput)

    await tSync1

    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([
        discoveryKey(core.key),
        discoveryKey(core2.key),
        discoveryKey(rehoster.ownKey)
      ]),
      'Synced the 2 new cores'
    )
  }

  {
    const syncInput = new Map()
    syncInput.set(idEnc.normalize(core.key), {})
    syncInput.set(idEnc.normalize(core3.key), { description: 'Describe' })
    rehoster.sync(syncInput)

    await tSync2

    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([
        discoveryKey(core.key),
        discoveryKey(core3.key),
        discoveryKey(rehoster.ownKey)
      ]),
      'Synced the 2 new cores'
    )

    t.is(
      (await rehoster.get(core3.key)).description,
      'Describe'
    )
  }

  testDone = true
})

test('Processes sync where only values change', async (t) => {
  const { bootstrap, rehoster } = await setup(t)
  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  const syncInput = new Map()
  syncInput.set(idEnc.normalize(core.key), {})
  syncInput.set(idEnc.normalize(core2.key), { description: 'I describe' })

  {
    rehoster.sync(syncInput)

    await once(rehoster, 'synced')

    const expected = new Set([
      [core.key, { description: null, version: CURRENT_VERSION }],
      [core2.key, { description: 'I describe', version: CURRENT_VERSION }]
    ])

    t.alike(
      new Set(await rehoster.getExplicitEntries()),
      expected
    )
  }

  syncInput.set(idEnc.normalize(core2.key), { description: 'Other' })
  {
    rehoster.sync(syncInput)

    await once(rehoster, 'synced')

    const expected = new Set([
      [core.key, { description: null, version: CURRENT_VERSION }],
      [core2.key, { description: 'Other', version: CURRENT_VERSION }]
    ])

    t.alike(
      new Set(await rehoster.getExplicitEntries()),
      expected
    )
  }
})

test('sync handles race conditions', async (t) => {
  const tSyncs = t.test('setup')
  tSyncs.plan(2) // the initial one and the last one--2nd one gets skipped
  const tSwarmLastSync = t.test('finish setup')
  tSwarmLastSync.plan(1)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)
  const core3 = await setupCore(t, bootstrap)

  rehoster.on('synced', (desiredState) => {
    tSyncs.pass('Completed a sync')
    if (DEBUG) console.log(desiredState)
  })
  rehoster.on('new-node', ({ publicKey }) => {
    if (b4a.equals(publicKey, core2.key)) {
      tSwarmLastSync.pass('core2 was added')
    }
  })

  const syncAttempts = []
  {
    const syncInput = new Map()
    syncInput.set(idEnc.normalize(core.key), {})
    syncAttempts.push(rehoster.sync(syncInput))
  }
  {
    const syncInput = new Map()
    syncInput.set(idEnc.normalize(core.key), {})
    syncInput.set(idEnc.normalize(core2.key), {})
    syncInput.set(idEnc.normalize(core3.key), {})
    syncAttempts.push(rehoster.sync(syncInput))
  }
  {
    const syncInput = new Map()
    syncInput.set(idEnc.normalize(core.key), {})
    syncInput.set(idEnc.normalize(core2.key), {})
    syncAttempts.push(rehoster.sync(syncInput))
  }

  await Promise.all(syncAttempts)
  await tSyncs
  await tSwarmLastSync

  t.alike(
    new Set(swarmManager.servedKeys),
    new Set([
      discoveryKey(core.key),
      discoveryKey(core2.key),
      discoveryKey(rehoster.ownKey)
    ]),
    'Synced the last added, 2 core request'
  )
})

test('Can add a drive (does not announce blobs key)', async function (t) {
  t.plan(3)
  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const drive = await setupDrive(t, bootstrap)

  let nrNodesAdded = 0
  rehoster.on('new-node', async (info) => {
    nrNodesAdded++
    if (nrNodesAdded < 3) return // includes root node itself

    if (nrNodesAdded > 3) {
      t.fail('new-node called too often')
    }
    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([drive.discoveryKey, rehoster.ownDiscoveryKey])
    )
    t.alike(
      new Set(swarmManager.requestedKeys),
      new Set([drive.blobs.core.discoveryKey]),
      'blobs core requested but not announced'
    )

    t.is((await rehoster.has(drive.key)), true)
  })
  await rehoster.add(drive.key)
})

test('Does not add a key twice', async function (t) {
  const tAdd = t.test('adding core')
  tAdd.plan(2)
  const tDel = t.test('Deleting core')
  tDel.plan(2)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const core = await setupCore(t, bootstrap)

  await rehoster.ready()

  rehoster.on('new-node', async () => {
    tAdd.alike(
      new Set(swarmManager.servedKeys),
      new Set([discoveryKey(core.key), discoveryKey(rehoster.ownKey)])
    )

    tAdd.is((await rehoster.has(core.key)), true)
  })

  await rehoster.add(core.key)
  await rehoster.add(core.key)

  await tAdd // Errors if new-node triggers more than once due to test's plan

  rehoster.on('deleted-node', async () => {
    if (rehoster.closing) return // closing also emits deleted nodes

    tDel.alike(
      new Set(swarmManager.servedKeys),
      new Set([discoveryKey(rehoster.ownKey)])
    )

    tDel.is((await rehoster.has(core.key)), false)
  })

  await rehoster.delete(core.key) // Ensure added only once
})

test('Also processes keys it cannot find, and connects to + downloads them when they come online', async function (t) {
  t.plan(3)

  const { bootstrap, rehoster } = await setup(t)
  const { swarm: coreSwarm, corestore } = await setupPeer(t, bootstrap)

  const core = corestore.get({ name: 'core' })
  await core.append('block0')
  await core.append('block1')
  // not swarmed yet

  await rehoster.ready()

  rehoster.on('new-node', async () => {
    t.is((await rehoster.has(core.key)), true)
    setTimeout(() => {
      coreSwarm.join(core.discoveryKey)
    }, 100)
  })

  rehoster.on('node-fully-downloaded', async ({ publicKey, coreLength }) => {
    t.alike(publicKey, core.key)
    t.alike(coreLength, 2)

    await coreSwarm.destroy()
    await corestore.close()
  })
  await rehoster.add(core.key)
})

test('Can close immediately after ready', async function (t) {
  const { rehoster, swarmManager } = await setup(t)
  await rehoster.ready()
  t.is(swarmManager.servedKeys.length, 1, 'sanity check')

  await rehoster.close()

  t.is(swarmManager.servedKeys.length, 0)
})

test('Can add multiple cores', async function (t) {
  t.plan(3)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  await rehoster.ready()

  let counter = 0
  rehoster.on('new-node', async (info) => {
    counter++
    if (counter < 2) return

    if (counter > 2) {
      t.fail('new-node called too often')
    }

    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([discoveryKey(core.key), discoveryKey(core2.key), discoveryKey(rehoster.ownKey)])
    )

    t.is((await rehoster.has(core.key)), true)
    t.is((await rehoster.has(core2.key)), true)
  })

  await rehoster.add(core.key)
  await rehoster.add(core2.key)
})

test('does not process invalid key and emits event', async function (t) {
  t.plan(2)
  const { rehoster, swarmManager } = await setup(t)
  await rehoster.ready()

  const notAKey = b4a.from('not a key')
  rehoster.on('invalid-key', ({ invalidKey, rehosterKey }) => {
    t.alike(invalidKey, notAKey, 'reports invalid-key event')
  })
  rehoster.on('new-node', (info) => {
    console.error(info)
    t.fail('added the invalid node')
  })

  await rehoster.bee.put(notAKey, null, {
    keyEncoding: REHOSTER_SUB
  })

  // just in case: give some time then verify it wasn't added
  await new Promise(resolve => setTimeout(resolve, 100))

  t.alike(
    new Set(swarmManager.servedKeys),
    new Set([discoveryKey(rehoster.ownKey)])
  )
})

test('Correctly rehosts another rehoster', async function (t) {
  t.plan(4)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const rehoster2 = await setupRehoster(t, bootstrap)

  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  await rehoster.ready()
  await rehoster.swarm.flush()
  await rehoster2.ready()

  let nrNodesAdded = 0
  rehoster.on('new-node', async (info) => {
    nrNodesAdded++
    if (nrNodesAdded < 3) return

    if (nrNodesAdded > 3) {
      t.fail('new-node called too often')
    }

    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([core.discoveryKey, core2.discoveryKey, rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
      'rehosts the cores and the sub rehoster itself'
    )

    t.is((await rehoster.has(core.key)), false, 'not a direct child')
    t.is((await rehoster.has(core2.key)), false, 'not a direct child')
    t.is((await rehoster.has(rehoster2.ownKey)), true)
  })

  await rehoster2.add(core2.key)
  await rehoster2.add(core.key)
  await rehoster.add(rehoster2.ownKey)
})

test('Skips over entries with incompatible major versions', async function (t) {
  const tSetup = t.test('setup')
  tSetup.plan(5)
  const { bootstrap, rehoster } = await setup(t)
  const rehoster2 = await setupRehoster(t, bootstrap)

  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  let nrNodes = 0 // for test flow
  rehoster.on('new-node', (info) => {
    if (++nrNodes === 3) tSetup.pass('added all nodes')
  })

  rehoster2.on('invalid-value', ({ rawEntry, error }) => {
    const { key } = rawEntry
    tSetup.ok(error.message.includes('other major version', 'major version error'))
    tSetup.alike(key, core2.key, 'expected core')
  })

  rehoster.on('invalid-value', ({ rawEntry, error }) => {
    const { key } = rawEntry
    tSetup.ok(error.message.includes('other major version', 'major version error'))
    tSetup.alike(key, core2.key, 'expected core')
  })

  await rehoster.ready()
  await rehoster.swarm.flush()
  await rehoster2.ready()

  await rehoster2.add(core2.key, { description: 'other major', major: 9999 })
  await rehoster2.add(core.key)
  await rehoster.add(rehoster2.ownKey)

  await tSetup

  t.alike(
    new Set(rehoster.swarmManager.servedKeys),
    new Set([core.discoveryKey, rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
    'Does not announce the core with the invalid major'
  )
  t.alike(
    new Set(rehoster2.swarmManager.servedKeys),
    new Set([core.discoveryKey, rehoster2.ownDiscoveryKey]),
    'Does not announce the core with the invalid major'
  )
})

test('Skips over entries with incompatible minor versions', async function (t) {
  const tSetup = t.test('setup')
  tSetup.plan(5)
  const { bootstrap, rehoster } = await setup(t)
  const rehoster2 = await setupRehoster(t, bootstrap)

  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  let nrNodes = 0 // for test flow
  rehoster.on('new-node', (info) => {
    if (++nrNodes === 3) tSetup.pass('added all nodes') // includes own core
  })

  rehoster2.on('invalid-value', ({ rawEntry, error }) => {
    const { key } = rawEntry
    tSetup.ok(error.message.includes('higher minor version', 'minor version error'))
    tSetup.alike(key, core2.key, 'expected core')
  })

  rehoster.on('invalid-value', ({ rawEntry, error }) => {
    const { key } = rawEntry
    tSetup.ok(error.message.includes('higher minor version', 'minor version error'))
    tSetup.alike(key, core2.key, 'expected core')
  })

  await rehoster.ready()
  await rehoster.swarm.flush()
  await rehoster2.ready()

  await rehoster2.add(core2.key, { description: 'higher minor', minor: 9999 })
  await rehoster2.add(core.key)
  await rehoster.add(rehoster2.ownKey)

  await tSetup

  t.alike(
    new Set(rehoster.swarmManager.servedKeys),
    new Set([core.discoveryKey, rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
    'Does not announce the core with the invalid minor'
  )
  t.alike(
    new Set(rehoster2.swarmManager.servedKeys),
    new Set([core.discoveryKey, rehoster2.ownDiscoveryKey]),
    'Does not announce the core with the invalid minor'
  )
})

test('Does not recurse eternally with a cycle', async function (t) {
  t.plan(4)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const rehoster2 = await setupRehoster(t, bootstrap)

  let nrNodesAdded = 0
  rehoster.on('new-node', async (info) => {
    if (DEBUG) console.log('rehoster new node', info)

    nrNodesAdded++
    if (nrNodesAdded < 3) return // includes own core

    if (nrNodesAdded > 3) {
      t.fail('new-node called too often')
    }

    t.alike(
      new Set(swarmManager.servedKeys),
      new Set([rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
      'rehosts the sub rehoster and itself'
    )
    t.is((await rehoster.has(rehoster2.ownKey)), true)
  })

  let reh2NrNodesAdded = 0
  rehoster2.on('new-node', async (info) => {
    reh2NrNodesAdded++
    if (reh2NrNodesAdded < 3) return // includes ow

    if (reh2NrNodesAdded > 3) {
      t.fail('new-node called too often')
    }
    t.alike(
      new Set(rehoster2.swarmManager.servedKeys),
      new Set([rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
      'rehosts the original rehoster'
    )
    t.is((await rehoster2.has(rehoster.ownKey)), true)
  })

  await rehoster.ready()
  await rehoster.swarm.flush()
  await rehoster2.ready()
  await rehoster2.add(rehoster.ownKey, { description: 'rehoster2' })
  await rehoster.add(rehoster2.ownKey, { description: 'rehoster1' })

  // Give some time for any potential recursion to trigger
  // (we rely on the new-node handlers over triggering to detect
  // a potential recursion)
  await new Promise(resolve => setTimeout(resolve, 1000))
})

test('Closes all non-duplicate child nodes when a sub-rehoster is deleted', async function (t) {
  const tSetup = t.test('setup')
  tSetup.plan(1)

  const tDel = t.test('delete node')
  tDel.plan(2)

  const { bootstrap, rehoster, swarmManager } = await setup(t)
  const rehoster2 = await setupRehoster(t, bootstrap)

  const core = await setupCore(t, bootstrap)
  const core2 = await setupCore(t, bootstrap)

  await rehoster.ready()
  await rehoster.swarm.flush()
  await rehoster2.ready()

  let nrNodesAdded = 0
  rehoster.on('new-node', async (info) => {
    nrNodesAdded++
    if (nrNodesAdded < 4) return

    if (nrNodesAdded > 4) {
      t.fail('new-node called too often')
    }

    tSetup.alike(
      new Set(swarmManager.servedKeys),
      new Set([core.discoveryKey, core2.discoveryKey, rehoster.ownDiscoveryKey, rehoster2.ownDiscoveryKey]),
      'rehosts the cores and the sub rehoster itself'
    )
  })

  await rehoster2.add(core2.key, { description: 'rehoster2-core2' })
  await rehoster2.add(core.key, { description: 'rehoster2-core1' })
  await rehoster.add(rehoster2.ownKey, { description: 'rehoster-reh2' })
  await rehoster.add(core.key, { description: 'rehoster-core1' }) // once directly, once indirectly

  await tSetup

  let delCounter = 0
  rehoster.on('deleted-node', ({ nrRefs }) => {
    if (rehoster.closing) return
    if (nrRefs > 0) return // we care only about fully clodes nodes
    delCounter++
    if (delCounter < 2) return

    if (delCounter > 2) t.fail('too many deleted nodes')

    tDel.alike(
      new Set(swarmManager.servedKeys),
      new Set([core.discoveryKey, rehoster.ownDiscoveryKey]),
      'No longer hosts the sub rehoster and the non-duplicate core'
    )
  })

  tDel.ok(rehoster.has(rehoster2.ownKey), 'sanity check')
  await rehoster.delete(rehoster2.ownKey)
})

test('example does not error', async t => {
  const runProc = spawn(
    process.execPath,
    [EXAMPLE_LOC]
  )

  // To avoid zombie processes in case there's an error
  const onUnexpectedProcessExit = () => {
    runProc.kill('SIGKILL')
  }
  process.on('exit', onUnexpectedProcessExit)

  runProc.stderr.on('data', d => {
    console.error(d.toString())
    t.fail('There should be no stderr')
  })

  const [code] = await once(runProc, 'exit')
  t.is(code, 0, '0 exit code')

  process.removeListener('exit', onUnexpectedProcessExit)
})

async function setupPeer (t, bootstrap) {
  const corestore = new Corestore(RAM)

  const swarm = new Hyperswarm({ bootstrap })
  swarm.on('connection', (socket) => {
    corestore.replicate(socket)
  })

  return { swarm, corestore }
}

async function setupCore (t, bootstrap) {
  const { swarm, corestore } = await setupPeer(t, bootstrap)
  const core = corestore.get({ name: 'core' })
  await core.append('Block0')
  await core.append('Block1')

  swarm.join(core.discoveryKey)
  await swarm.flush()

  const order = peerOrder++
  t.teardown(async () => {
    await swarm.destroy()
    await corestore.close()
  }, { order })

  return core
}

async function setupDrive (t, bootstrap) {
  const { swarm, corestore } = await setupPeer(t, bootstrap)
  const drive = new Hyperdrive(corestore)
  await drive.put('sup', 'here')

  swarm.join(drive.discoveryKey)
  await swarm.flush()

  const order = peerOrder++
  t.teardown(async () => {
    await swarm.destroy()
    await corestore.close()
  }, { order })

  return drive
}

async function setupRehoster (t, bootstrap) {
  const { corestore, swarm } = await setupPeer(t, bootstrap)

  const swarmManager = new SwarmManager(swarm, corestore)
  const bee = new Hyperbee(corestore.get({ name: 'bee' }))

  const rehoster = new Rehoster(corestore, swarmManager, bee)

  t.teardown(async () => {
    await swarmManager.close()
    await rehoster.close()
  }, { order: rehosterOrder++ })

  return rehoster
}

async function setup (t) {
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const rehoster = await setupRehoster(t, bootstrap)

  t.teardown(async () => {
    await rehoster.close()
    await testnet.destroy()
  }, { order: 1000 })

  return { rehoster, bootstrap, swarmManager: rehoster.swarmManager }
}
