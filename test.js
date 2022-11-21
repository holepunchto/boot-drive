'use strict'

const test = require('brittle')
const Boot = require('./index.js')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('@hyperswarm/testnet')

test('basic', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.alike(await boot.start('/index.js'), { exports: 'hello' })
})

test('entrypoint from package.json', async function (t) {
  const [drive] = create()

  await drive.put('/package.json', Buffer.from(JSON.stringify({ main: 'index.js' })))
  await drive.put('/index.js', Buffer.from('module.exports = "hello"'))

  const boot = new Boot(drive)
  t.alike(await boot.start(), { exports: 'hello' })
})

test('require file within drive', async function (t) {
  const [drive] = create()

  await drive.put('/index.js', Buffer.from(`
    const func = require("./func.js")
    module.exports = func()
  `))
  await drive.put('/func.js', Buffer.from('module.exports = () => "hello func"'))

  const boot = new Boot(drive)
  t.alike(await boot.start('/index.js'), { exports: 'hello func' })
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
  t.alike(await boot.start('/index.js'), { exports: 'hello' })
})

function create (key) {
  const corestore = new Corestore(RAM)
  const drive = new Hyperdrive(corestore, key)
  return [drive, corestore]
}

async function replicate (t, bootstrap, corestore, drive, { server = false, client = false } = {}) {
  await drive.ready()

  const swarm = new Hyperswarm({ bootstrap })
  t.teardown(() => swarm.destroy())
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server, client })
  await swarm.flush()

  return [swarm]
}
