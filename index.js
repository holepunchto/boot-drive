'use strict'

const ScriptLinker = require('script-linker')
const { builtinModules } = require('module')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')

const approvedModules = new Set(['sodium-native'])

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.modules = new Set([...builtinModules/* , ...approvedModules */])

    this.linker = new ScriptLinker({
      cacheSize: Infinity,
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('No entry: ' + name)
        return buffer
      }
    })

    if (opts.modules) for (const name of opts.modules) this.modules.add(name)
  }

  async start (entrypoint) {
    if (!entrypoint) {
      const pkg = await this.drive.get('/package.json')
      entrypoint = JSON.parse(pkg || '{}').main
      if (!entrypoint) throw new Error('No entrypoint')
      entrypoint = path.resolve('/', entrypoint)
    }

    let first = null

    for await (const dep of this.linker.dependencies(entrypoint)) {
      if (!first) first = dep

      const name = dep.module._moduleInfo?.package?.name

      if (approvedModules.has(name)) {
        const filename = path.join('prebuilds', process.platform + '-' + process.arch, 'node.napi.node')
        const binding = await this.drive.get(path.join(dep.module.dirname, filename))

        await fsp.mkdir(path.dirname(filename), { recursive: true })
        fs.writeFileSync(filename, binding) // + async
      }

      /* if (name === 'node-gyp-build') {
        dep.module.source = `
        const path = require('path')

        module.exports = (dirname) => {
          console.log(dirname) // => '/node_modules/sodium-native'
          const filename = path.join(dirname, 'prebuilds', process.platform + '-' + process.arch, 'node.napi.node')
          console.log(filename)

          const p = path.parse(filename)
          console.log()

          const dirWithoutRoot = p.dir.replace(p.root, '')
          const binding = path.join(dirWithoutRoot, p.base)
          console.log(binding)

          console.log('module', require(binding))

          return require(binding)
        }
        `
      } */
    }

    const cache = {}
    const nodeRequire = require
    const { linker, modules } = this

    return run(first.module)

    function run (mod) {
      if (cache[mod.filename]) return cache[mod.filename]

      const m = cache[mod.filename] = {
        exports: {}
      }

      require.cache = cache

      const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source) // eslint-disable-line no-new-func
      wrap(require, mod.dirname, mod.filename, m, m.exports)

      return m

      function require (req) {
        if (modules.has(req)) {
          return nodeRequire(req)
        }

        for (const r of mod.resolutions) {
          if (r.input === req) {
            if (!r.output) throw new Error('MODULE_NOT_FOUND: ' + r.input)
            if (req === 'node-gyp-build') {
              console.log('about to run node-gyp-build', process.cwd(), r.output)
              return customBinding
            }
            return run(linker.modules.get(r.output)).exports
          }
        }
      }
    }
  }
}

function customBinding (dirname) {
  console.log('customBinding', { dirname }, process.cwd())
  // var sodium = require('node-gyp-build')(__dirname)

  console.log(dirname) // => '/node_modules/sodium-native'
  console.log(process.cwd()) // => '/home/lucas/Desktop/boot-example'
  const filename = path.join(process.cwd(), 'prebuilds', process.platform + '-' + process.arch, 'node.napi.node')
  console.log(filename)

  const p = path.parse(filename)
  console.log('p', p)

  // const dirWithoutRoot = p.dir.replace(p.root, '')
  // const binding = path.join(dirWithoutRoot, p.base)
  const binding = filename
  console.log('binding', binding)

  return require(binding)
}
