'use strict'

const test = require('brittle')
const Boot = require('./index.js')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')

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

function create () {
  const store = new Corestore(RAM)
  const drive = new Hyperdrive(store)
  return { drive }
}
