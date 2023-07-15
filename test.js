'use strict'

const test = require('brittle')
const Boot = require('./index.js')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')

test('basic', async function (t) {
  t.plan(2)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'hello')

  t.is(exec(boot.stringify()), 'hello')
})

test('entrypoint in constructor', async function (t) {
  t.plan(2)

  const [drive] = create()
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive, { entrypoint: 'random-file.js' })
  await boot.warmup()

  t.is(boot.start(), 'hello')

  t.is(exec(boot.stringify()), 'hello')
})

test('entrypoint in warmup', async function (t) {
  t.plan(2)

  const [drive] = create()
  await drive.put('/index.js', Buffer.from('module.exports = "world"'))
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"; require("./index.js")'))

  const boot = new Boot(drive)
  await boot.warmup('random-file.js')

  t.is(boot.start(), 'world')

  t.is(exec(boot.stringify()), 'world')
})

test('entrypoint in start and stringify', async function (t) {
  t.plan(2)

  const [drive] = create()
  await drive.put('/index.js', Buffer.from('require("./random-file.js")'))
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start('random-file.js'), 'hello')

  t.is(exec(boot.stringify('random-file.js')), 'hello')
})

test('entrypoint from package.json', async function (t) {
  t.plan(2)

  const [drive] = create()

  await drive.put('/package.json', Buffer.from(JSON.stringify({ main: 'random-file.js' })))
  await drive.put('/random-file.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'hello')

  t.is(exec(boot.stringify()), 'hello')
})

test('no file', async function (t) {
  t.plan(1)

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
  t.plan(1)

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
  t.plan(1)

  const [drive] = create()

  const boot = new Boot(drive)
  t.is(boot.cwd, '.')
})

test('change working directory', async function (t) {
  t.plan(1)

  const [drive] = create()

  const boot = new Boot(drive, { cwd: './working-dir' })
  t.is(boot.cwd, './working-dir')
})

test('dependencies', async function (t) {
  t.plan(9)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.is(boot.dependencies.size, 0)
  await boot.warmup()
  t.is(boot.dependencies.size, 1)
  t.ok(boot.dependencies.has('/index.js'))
  t.is(boot.start(), 'hello')
  t.is(exec(boot.stringify()), 'hello')

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
  t.is(exec(boot3.stringify()), 'hello')
})

test('require file within drive', async function (t) {
  t.plan(2)

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

  t.is(exec(boot.stringify()), 'hello func: 4')
})

test('require module with prebuilds', async function (t) {
  t.plan(2)

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
  await boot.warmup()

  t.is(boot.start(), 64)

  t.is(exec(boot.stringify()), 64)
})

test('absolute prebuilds path for stringify', async function (t) {
  t.plan(2)

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
      exec(boot.stringify())
      t.fail('should have failed')
    } catch (err) {
      t.ok(isNodeRequire(err))
    }
  }

  {
    const boot = new Boot(drive, { cwd: createTmpDir(t), absolutePrebuilds: true })
    await boot.warmup()

    t.is(exec(boot.stringify()), 64)
  }
})

test('additional builtins', async function (t) {
  t.plan(4)

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
  t.is(exec(source), 64)

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
      exec(boot.stringify())
      t.fail('should have failed')
    } catch (err) {
      t.ok(isBootRequire(err, 'sodium-native'))
    }
  }
})

test('additional builtin is not installed', async function (t) {
  t.plan(2)

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
    exec(boot.stringify())
    t.fail('should have failed')
  } catch (err) {
    t.ok(isNodeRequire(err))
  }
})

test('source overwrites', async function (t) {
  t.plan(2)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "this will be overwritten"'))
  await drive.put('/message.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive, {
    sourceOverwrites: {
      '/index.js': 'module.exports = require("./message.js")'
    }
  })

  await boot.warmup()

  t.is(boot.start(), 'hello')

  t.is(exec(boot.stringify()), 'hello')
})

test('remote drive', async function (t) {
  t.plan(2)

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

  t.is(exec(boot.stringify()), 'hello')
})

test('stringify with prebuilds', async function (t) {
  t.plan(2)

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
  await boot.warmup()

  t.is(boot.start(), 64)

  const source = boot.stringify()
  t.is(exec(source), 64)
})

test('require json file', async function (t) {
  t.plan(2)

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
  t.alike(exec(source), { assert: true })
})

test('require main property', async function (t) {
  t.plan(2)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = require.main'))

  const boot = new Boot(drive)
  await boot.warmup()

  const main = {
    filename: '/index.js',
    dirname: '/',
    type: 'commonjs',
    requires: {},
    source: 'module.exports = require.main',
    exports: {}
  }
  main.exports = main

  t.alike(boot.start(), main)

  t.alike(exec(boot.stringify()), main)
})

test('cache (shallow)', async function (t) {
  t.plan(2)

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
  t.is(exec(source), true)
})

test('cache (internal)', async function (t) {
  t.plan(4)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const data1 = require("./data.json")
    const data2 = require("./data.json")
    module.exports = require.cache
  `))
  await drive.put('/data.json', Buffer.from('{ "leet": 1337 }'))

  const cache = {}

  const boot = new Boot(drive, { cache })
  await boot.warmup()

  t.alike(cache, {})

  const expected = {
    '/index.js': {
      filename: '/index.js',
      dirname: '/',
      type: 'commonjs',
      requires: { './data.json': { output: '/data.json' } },
      source: '\n' +
        '    const data1 = require("./data.json")\n' +
        '    const data2 = require("./data.json")\n' +
        '    module.exports = require.cache\n' +
        '  ',
      exports: {} // Circular reference
    },
    '/data.json': {
      filename: '/data.json',
      dirname: '/',
      type: 'json',
      requires: {},
      source: '{ "leet": 1337 }',
      exports: { leet: 1337 }
    }
  }

  expected['/index.js'].exports = expected // Circular reference

  t.alike(boot.start(), expected)

  t.alike(cache, expected)

  t.alike(exec(boot.stringify()), expected)
})

test('error stack', async function (t) {
  t.plan(6)

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
    t.is(stack[1], 'at foo (/index.js:5:29)') // => 3:29
    t.is(stack[2], 'at eval (/index.js:4:5)') // => 2:5
  }

  try {
    const source = boot.stringify()
    exec(source)
    t.fail('should have failed')
  } catch (error) {
    const stack = error.stack.split('\n').map(v => v.trim())

    t.is(stack[0], 'Error: test')
    t.is(stack[1], 'at foo (/index.js:5:29)') // => 3:29
    t.is(stack[2], 'at eval (/index.js:4:5)') // => 2:5
  }
})

test('exports correctly even if returns different', async function (t) {
  t.plan(2)

  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    module.exports = 'a'

    'b'
  `))

  const boot = new Boot(drive)
  await boot.warmup()

  t.is(boot.start(), 'a')

  t.is(exec(boot.stringify()), 'a')
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

function exec (src) {
  const evaluate = new Function('require', 'module', 'exports', '__src', 'return eval(__src)') // eslint-disable-line no-new-func
  const m = { exports: {} }
  return evaluate(require, m, m.exports, src)
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
