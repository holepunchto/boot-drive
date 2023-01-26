'use strict'

const test = require('brittle')
const Boot = require('./index.js')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')
const fsp = require('fs/promises')
const path = require('path')

test('basic', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'hello')
})

test('entrypoint', async function (t) {
  const [drive] = create()
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive, { entrypoint: 'random-file.js' })
  await boot.warmup()

  t.is(boot.start(), 'hello')
})

test('entrypoint from package.json', async function (t) {
  const [drive] = create()

  await drive.put('/package.json', Buffer.from(JSON.stringify({ main: 'random-file.js' })))
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'hello')
})

test('no file', async function (t) {
  const [drive] = create()

  const boot = new Boot(drive)

  try {
    await boot.warmup()
    t.fail('should have failed to start')
  } catch (error) {
    t.is(error.message, 'ENOENT: /index.js')
  }
})

test('entrypoint not found', async function (t) {
  const [drive] = create()

  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)

  try {
    await boot.warmup()
    t.fail('should have failed to start')
  } catch (error) {
    t.is(error.message, 'ENOENT: /index.js')
  }
})

test('default working directory', async function (t) {
  const [drive] = create()

  const boot = new Boot(drive)
  t.is(boot.cwd, '.')
})

test('change working directory', async function (t) {
  const [drive] = create()

  const boot = new Boot(drive, { cwd: './working-dir' })
  t.is(boot.cwd, './working-dir')
})

test('dependencies', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.is(boot.dependencies.size, 0)
  await boot.warmup()
  t.is(boot.dependencies.size, 1)
  t.ok(boot.dependencies.has('/index.js'))
  t.is(boot.start(), 'hello')

  await drive.del('/index.js')

  try {
    const boot2 = new Boot(drive)
    await boot2.warmup()
    t.fail('should have failed to warmup')
  } catch (error) {
    t.is(error.message, 'ENOENT: /index.js')
  }

  const boot3 = new Boot(drive, { dependencies: boot.dependencies })
  t.is(boot3.dependencies, boot.dependencies)
  await boot3.warmup()
  t.is(boot3.start(), 'hello')
})

test('require file within drive', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const func = require("./func.js")
    const net = require("net")
    const isIP = net.isIP('127.0.0.1')
    module.exports = func() + ': ' + isIP
  `))
  await drive.put('/func.js', Buffer.from('module.exports = () => "hello func"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'hello func: 4')
})

test('require module with prebuilds', async function (t) {
  const [drive] = create()

  const src = new Localdrive(__dirname)
  const m1 = new MirrorDrive(src, drive, { prefix: 'node_modules/sodium-native' })
  const m2 = new MirrorDrive(src, drive, { prefix: 'node_modules/node-gyp-build' })
  const m3 = new MirrorDrive(src, drive, { prefix: 'node_modules/b4a' })
  await Promise.all([m1.done(), m2.done(), m3.done()])

  const sodium = require('sodium-native')
  sodium.$used = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (sodium.$used) throw new Error("sodium-native was already imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive)

  try {
    await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
  } catch {}

  await boot.warmup()

  t.is(boot.start(), 64)

  await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
})

test.skip('add module', async function (t) {
  const [drive] = create()

  const sodium = require('sodium-native')
  sodium.$used = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (!sodium.$used) throw new Error("sodium-native should have been imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive, { modules: ['sodium-native'] })
  boot.modules.add('b4a')
  await boot.warmup()

  t.is(boot.start(), 64)
})

test('remote drive', async function (t) {
  const { bootstrap } = await createTestnet(3, t.teardown)

  // seed
  const [drive, corestore] = create()
  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))
  await replicate(t, bootstrap, corestore, drive, { server: true })

  // download
  const [drive2, corestore2] = create(drive.key)
  const done = drive2.findingPeers()
  replicate(t, bootstrap, corestore2, drive2, { client: true }).then(done)

  const boot = new Boot(drive2)
  await boot.warmup()

  t.is(boot.start(), 'hello')
})

test('stringify', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const net = require("net")
    const func = require("./func.js")
    const isIP = net.isIP('127.0.0.1')
    module.exports = func() + ': ' + isIP
  `.trim()))
  await drive.put('/func.js', Buffer.from('module.exports = () => "hello func"'))

  const boot = new Boot(drive)
  await boot.warmup()

  const source = boot.stringify()
  t.is(eval(source), 'hello func: 4') // eslint-disable-line no-eval
})

test('stringify with prebuilds', async function (t) {
  const [drive] = create()

  const src = new Localdrive(__dirname)
  const m1 = new MirrorDrive(src, drive, { prefix: 'node_modules/sodium-native' })
  const m2 = new MirrorDrive(src, drive, { prefix: 'node_modules/node-gyp-build' })
  const m3 = new MirrorDrive(src, drive, { prefix: 'node_modules/b4a' })
  await Promise.all([m1.done(), m2.done(), m3.done()])

  const sodium = require('sodium-native')
  sodium.$used = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (sodium.$used) throw new Error("sodium-native was already imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive)

  try {
    await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
  } catch {}

  await boot.warmup()

  const source = boot.stringify()
  t.is(eval(source), 64) // eslint-disable-line no-eval

  await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
})

test('require json file', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const data = require("./data.json")
    module.exports = data
  `))
  await drive.put('/data.json', Buffer.from('{ "assert": true }'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.alike(boot.start(), { assert: true })

  const source = boot.stringify()
  t.alike(eval(source), { assert: true }) // eslint-disable-line no-eval
})

test('cache (shallow)', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const rand1 = require("./rand.js")
    const rand2 = require("./rand.js")
    module.exports = rand1 === rand2
  `))
  await drive.put('/rand.js', Buffer.from('module.exports = Math.random()'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), true)

  const source = boot.stringify()
  t.is(eval(source), true) // eslint-disable-line no-eval
})

test('cache (internal)', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const data1 = require("./data.json")
    const data2 = require("./data.json")
    module.exports = data1 === data2
  `))
  await drive.put('/data.json', Buffer.from('{ "leet": 1337 }'))

  const cache = {}
  const boot = new Boot(drive, { cache })
  await boot.warmup()

  t.alike(cache, {})
  t.is(boot.start(), true)
  t.alike(cache, { '/index.js': { exports: true }, '/data.json': { exports: { leet: 1337 } } })

  // stringify() does not expose a cache to check against
  const source = boot.stringify()
  t.is(eval(source), true) // eslint-disable-line no-eval
})

test.solo('capture stack trace', async function (t) {
  const [drive] = create()

  const src = new Localdrive(__dirname)
  const m1 = new MirrorDrive(src, drive, { prefix: 'node_modules/poor-mans-source-map' })
  await m1.done()

  await drive.put('/index.js', Buffer.from(`
    const captureStack = require('poor-mans-source-map')

    foo()

    function foo () {
      captureStack([ { start: 10, end: 10, filename: '/path/to/file.js' } ])

      throw new Error('test')
    }
  `.trim()))

  const boot = new Boot(drive)

  try {
    await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
  } catch {}

  await boot.warmup()

  t.is(boot.start(), 64)

  await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
})

async function replicate (t, bootstrap, corestore, drive, { server = false, client = false } = {}) {
  await drive.ready()

  const swarm = new Hyperswarm({ bootstrap })
  t.teardown(() => swarm.destroy())
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server, client })
  await swarm.flush()

  return [swarm]
}

function create (key) {
  const corestore = new Corestore(RAM)
  const drive = new Hyperdrive(corestore, key)
  return [drive, corestore]
}
