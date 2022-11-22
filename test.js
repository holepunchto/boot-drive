'use strict'

const test = require('brittle')
const Boot = require('./index.js')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')

test('basic', async function (t) {
  const { drive } = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.alike(await boot.start('/index.js'), { exports: 'hello' })
})

test('entrypoint from package.json', async function (t) {
  const { drive } = create()

  await drive.put('/package.json', Buffer.from(JSON.stringify({ main: 'index.js' })))
  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.alike(await boot.start(), { exports: 'hello' })
})

test('require file within drive', async function (t) {
  const { drive } = create()

  await drive.put('/index.js', Buffer.from(`
    const func = require("./func.js")
    module.exports = func()
  `))
  await drive.put('/func.js', Buffer.from('module.exports = () => "hello func"'))

  const boot = new Boot(drive)
  t.alike(await boot.start('/index.js'), { exports: 'hello func' })
})

test.solo('require module with prebuilds', async function (t) {
  const { drive } = create()

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
  t.alike(await boot.start('/index.js'), { exports: 64 })
})

function create () {
  const store = new Corestore(RAM)
  const drive = new Hyperdrive(store)
  return { drive }
}
