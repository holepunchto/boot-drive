const fs = require('fs')
const path = require('path')
const minimist = require('minimist')
const ScriptLinker = require('script-linker')
const builtinModules = new Set(require('module').builtinModules)

const argv = minimist(process.argv.slice(2))
if (!argv.entrypoint) throw new Error('--entrypoint is required')

const entrypoint = path.resolve(argv.entrypoint)
// const root = path.dirname(entrypoint)
// const entrypoint = path.join('/', path.basename(entrypoint))

if (argv['add-module']) {
  const mods = argv['add-module']
  const addModules = Array.isArray(mods) ? mods : [mods]
  for (const name of addModules) builtinModules.add(name)
}

const s = new ScriptLinker({
  cacheSize: Infinity,
  readFile (name) {
    // console.log('readFile', name)
    return fs.promises.readFile(name)
  }
})

main()

async function main () {
  let first = null

  for await (const dep of s.dependencies(entrypoint)) {
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
