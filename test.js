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
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')

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
  sodium.$used1 = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (sodium.$used1) throw new Error("sodium-native was already imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive, { cwd: createTmpDir(t), absolutePrebuilds: true })

  /* const boot = new Boot(drive)

  try {
    await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
  } catch {} */

  await boot.warmup()

  t.is(boot.start(), 64)

  // await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
})

test('absolute prebuilds path for stringify', async function (t) {
  const [drive] = create()

  const src = new Localdrive(__dirname)
  await src.mirror(drive, { prefix: 'node_modules/sodium-native' }).done()
  await src.mirror(drive, { prefix: 'node_modules/node-gyp-build' }).done()
  await src.mirror(drive, { prefix: 'node_modules/b4a' }).done()

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")

    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)

    module.exports = buffer.toString('hex').length
  `))

  {
    const boot = new Boot(drive, { cwd: createTmpDir(t), absolutePrebuilds: false })
    await boot.warmup()

    try {
      eval(boot.stringify()) // eslint-disable-line no-eval
      t.fail('should have failed')
    } catch (err) {
      t.ok(isNodeRequire(err))
    }
  }

  {
    const boot = new Boot(drive, { cwd: createTmpDir(t), absolutePrebuilds: true })
    await boot.warmup()

    t.is(eval(boot.stringify()), 64) // eslint-disable-line no-eval
  }
})

test('additional builtins', async function (t) {
  const [drive] = create()

  const sodium = require('sodium-native')
  sodium.$used2 = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (!sodium.$used2) throw new Error("sodium-native should have been imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive, { additionalBuiltins: ['sodium-native', 'b4a'] })
  await boot.warmup()

  t.is(boot.start(), 64)

  const source = boot.stringify()
  t.is(eval(source), 64) // eslint-disable-line no-eval

  {
    const boot = new Boot(drive)
    await boot.warmup()

    try {
      boot.start()
      t.fail('should have failed')
    } catch (err) {
      t.ok(isBootRequire(err, 'sodium-native'))
    }

    try {
      eval(boot.stringify()) // eslint-disable-line no-eval
      t.fail('should have failed')
    } catch (err) {
      t.ok(isBootRequire(err, 'sodium-native'))
    }
  }
})

test('additional builtin is not installed', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const Random = require("random-library")
  `))

  const boot = new Boot(drive, { additionalBuiltins: ['random-library'] })
  await boot.warmup()

  try {
    boot.start()
    t.fail('should have failed')
  } catch (err) {
    t.ok(isNodeRequire(err))
  }

  try {
    eval(boot.stringify()) // eslint-disable-line no-eval
    t.fail('should have failed')
  } catch (err) {
    t.ok(isNodeRequire(err))
  }
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
  sodium.$used3 = true

  await drive.put('/index.js', Buffer.from(`
    const sodium = require("sodium-native")
    const b4a = require("b4a")
    if (sodium.$used3) throw new Error("sodium-native was already imported before")
    const buffer = b4a.allocUnsafe(32)
    sodium.randombytes_buf(buffer)
    module.exports = buffer.toString('hex').length
  `))

  const boot = new Boot(drive, { cwd: createTmpDir(t), absolutePrebuilds: true })

  /* try {
    await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
  } catch {} */

  await boot.warmup()

  const source = boot.stringify()
  t.is(eval(source), 64) // eslint-disable-line no-eval

  // await fsp.rm(path.resolve(boot.cwd, './prebuilds'), { recursive: true })
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

test('error stack', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const a = 10
    foo()
    function foo () { throw new Error('test') }
    const b = 10
  `.trim()))

  const boot = new Boot(drive)
  await boot.warmup()

  try {
    boot.start()
    t.fail('should have failed')
  } catch (error) {
    const stack = error.stack.split('\n').map(v => v.trim())

    t.is(stack[0], 'Error: test')
    t.is(stack[1], 'at foo (/index.js:3:29)')
    t.is(stack[2], 'at eval (/index.js:2:5)')
  }

  try {
    const source = boot.stringify()
    eval(source) // eslint-disable-line no-eval
    t.fail('should have failed')
  } catch (error) {
    const stack = error.stack.split('\n').map(v => v.trim())

    t.is(stack[0], 'Error: test')
    t.is(stack[1], 'at foo (/index.js:3:29)')
    t.is(stack[2], 'at eval (/index.js:2:5)')
  }
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

function isNodeRequire (err) {
  return err.code === 'MODULE_NOT_FOUND' && err.message.startsWith('Cannot find module')
}

function isBootRequire (error, dependency) {
  return error.code === undefined && error.message.startsWith('Could not resolve ' + dependency)
}

function createTmpDir (t) {
  const tmpdir = path.join(os.tmpdir(), 'localdrive-test-')
  const dir = fs.mkdtempSync(tmpdir)
  // Windows can't delete the folder (EPERM) due it's still used by a required module
  if (process.platform !== 'win32') t.teardown(() => rmdir(dir))
  return dir
}

async function rmdir (dir) {
  try {
    await fsp.rm(dir, { recursive: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
}
