const fs = require('fs')
const path = require('path')
const minimist = require('minimist')
const ScriptLinker = require('script-linker')
const builtinModules = new Set(require('module').builtinModules)
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const RAM = require('random-access-memory')
const Hyperswarm = require('hyperswarm')

// node boot.js --key <drive key> --entrypoint /index.js

const argv = minimist(process.argv.slice(2))
// if (!argv.store) throw new Error('--store <path to corestore> is required')
if (!argv.key) throw new Error('--key <drive key> is required')
if (!argv.entrypoint) throw new Error('--entrypoint <main filename of drive> is required')

const corestore = new Corestore(argv.store || RAM)
const drive = new Hyperdrive(corestore, parsePublicKey(argv.key))

if (argv['add-module']) {
  const mods = argv['add-module']
  const addModules = Array.isArray(mods) ? mods : [mods]
  for (const name of addModules) builtinModules.add(name)
}

main()

async function main () {
  await drive.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => corestore.replicate(conn))
  swarm.join(drive.discoveryKey, { server: false, client: true })
  const done = drive.findingPeers()
  swarm.flush().then(done, done)

  await drive.download('/')
  await swarm.destroy()

  const s = new ScriptLinker({
    cacheSize: Infinity,
    async readFile (name) {
      const buffer = await drive.get(name)
      if (!buffer) throw new Error('some err like fs.promises.readFile')
      return buffer
    }
  })

  let first = null

  for await (const dep of s.dependencies(argv.entrypoint)) {
    if (!first) first = dep
  }

  const cache = {}
  const nodeRequire = require

  run(first.module)

  function run (mod) {
    if (cache[mod.filename]) return cache[mod.filename]

    const m = cache[mod.filename] = {
      exports: {}
    }

    require.cache = cache

    const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source)
    wrap(require, mod.dirname, mod.filename, m, m.exports)

    return m

    function require (req) {
      if (builtinModules.has(req)) {
        return nodeRequire(req)
      }

      for (const r of mod.resolutions) {
        if (r.input === req) {
          return run(s.modules.get(r.output)).exports
        }
      }
    }
  }
}

function parsePublicKey (key) {
  // if (typeof key === 'string' && key.length === 52) key = z32.decode(key)
  if (typeof key === 'string' && key.length === 64) key = Buffer.from(key, 'hex')
  return key
}
