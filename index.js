'use strict'

const { builtinModules } = require('module')
const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('script-linker')
const sodium = require('sodium-native')
const b4a = require('b4a')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.modules = new Set(builtinModules)

    this.entrypoint = opts.entrypoint || null
    this.prebuildsPath = opts.prebuildsPath || 'prebuilds'
    this.prebuilds = new Map()
    this.cache = opts.cache || {}

    this.linker = new ScriptLinker({
      cacheSize: Infinity,
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('ENOENT: ' + name)
        return buffer
      }
    })

    if (opts.modules) for (const name of opts.modules) this.modules.add(name)

    this.first = null
  }

  async _savePrebuildToDisk (mod) {
    const hasBuilds = resolve(mod, 'node-gyp-build')
    if (!hasBuilds) return

    const entrypath = mod.dirname + '/prebuilds/' + process.platform + '-' + process.arch + '/node.napi.node'
    const buffer = await this.drive.get(entrypath)
    if (!buffer) return

    const filename = path.join(this.prebuildsPath, mod.package?.name + '-' + generichash(buffer) + '.node')
    const exists = await fileExists(filename)
    if (!exists) {
      await fsp.mkdir(this.prebuildsPath, { recursive: true })
      await atomicWriteFile(filename, buffer)
    }

    this.prebuilds.set(mod.dirname, './' + filename)
  }

  async warmup () {
    if (!this.entrypoint) {
      const pkg = await this.drive.get('/package.json')
      this.entrypoint = JSON.parse(pkg || '{}').main
      if (!this.entrypoint) this.entrypoint = 'index.js'
    }
    this.entrypoint = path.resolve('/', this.entrypoint)

    this.first = null

    for await (const dep of this.linker.dependencies(this.entrypoint)) {
      if (!this.first) this.first = dep

      await this._savePrebuildToDisk(dep.module)
    }
  }

  start () {
    const self = this
    const nodeRequire = require
    const { linker, modules, cache } = this

    return run(this.first.module)

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

        const output = resolve(mod, req)
        if (!output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

        if (req === 'node-gyp-build') return customBinding.bind(self)
        return run(linker.modules.get(output)).exports
      }
    }
  }

  _bundleDeps (mod) {
    const dependencies = {}
    const stack = [mod]

    while (stack.length) {
      const mod = stack.pop()
      const dep = dependencies[mod.filename] = {
        filename: mod.filename,
        dirname: mod.dirname,
        requires: {},
        source: mod.source
      }

      for (const r of mod.resolutions) {
        const isModule = this.modules.has(r.input)

        if (isModule || !r.output) {
          dep.requires[r.input] = { output: r.output, shouldNodeRequire: isModule }
          continue
        }

        if (r.input === 'node-gyp-build') {
          dep.requires[r.input] = { output: this.prebuilds.get(mod.dirname) }
          continue
        }

        dep.requires[r.input] = { output: r.output }

        stack.push(this.linker.modules.get(r.output))
      }
    }

    return dependencies
  }

  stringify () {
    const dependencies = this._bundleDeps(this.first.module)

    return `
    'use strict'

    const dependencies = ${JSON.stringify(dependencies, null, 2)}
    const nodeRequire = require

    run(dependencies['${this.first.module.filename}'])

    ${run.toString()}
    `.trim()

    // on purpose very similar to run() of start() to try re-use it
    function run (mod, cache = {}) {
      if (cache[mod.filename]) return cache[mod.filename]

      const m = cache[mod.filename] = {
        exports: {}
      }

      require.cache = cache

      const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source) // eslint-disable-line no-new-func
      wrap(require, mod.dirname, mod.filename, m, m.exports)

      return m

      function require (req) {
        const r = mod.requires[req]

        if (r.shouldNodeRequire) {
          return nodeRequire(r.output) // eslint-disable-line no-undef
        }

        if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

        if (req === 'node-gyp-build') return () => nodeRequire(r.output) // eslint-disable-line no-undef

        return run(dependencies[r.output], cache).exports
      }
    }
  }
}

function resolve (mod, input) {
  for (const r of mod.resolutions) {
    if (r.input === input) {
      if (!r.output) break
      return r.output
    }
  }
  return null
}

function customBinding (dirname) {
  return require(this.prebuilds.get(dirname))
}

async function atomicWriteFile (filename, buffer) {
  const tmpfile = filename + '.tmp.' + Math.random()
  await fsp.writeFile(tmpfile, buffer, { flags: 'wx' })
  await fsp.rename(tmpfile, filename)
}

async function fileExists (filename) {
  try {
    await fsp.stat(filename)
  } catch (error) {
    if (error.code === 'ENOENT') return false
  }
  return true
}

function generichash (data) {
  const out = b4a.allocUnsafe(32)
  sodium.crypto_generichash(out, data)
  return out.toString('hex')
}
