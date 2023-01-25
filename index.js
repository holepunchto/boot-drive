'use strict'

const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('script-linker')
const sodium = require('sodium-native')
const b4a = require('b4a')
const unixResolve = require('unix-path-resolve')
const { builtins } = require('./defaults.js')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.cache = opts.cache || {}

    this.entrypoint = opts.entrypoint || null
    this.main = null
    this.dependencies = opts.dependencies || new Map()

    this.cwd = opts.cwd || '.'
    this.prebuilds = new Map()

    this.linker = new ScriptLinker({
      readFile: async (name) => {
        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('ENOENT: ' + name)
        return buffer
      },
      builtins
    })
  }

  async _savePrebuildToDisk (mod) {
    const hasBuilds = resolve(mod, 'node-gyp-build')
    if (!hasBuilds) return

    let dirname = mod.dirname
    let buffer = null
    while (true) {
      const entrypath = dirname + '/prebuilds/' + process.platform + '-' + process.arch + '/node.napi.node'
      buffer = await this.drive.get(entrypath)
      if (buffer) break
      if (dirname === '/') return
      dirname = unixResolve(dirname, '..')
    }

    const basename = mod.package?.name + '-' + generichash(buffer) + '.node'
    const filename = path.resolve(this.cwd, 'prebuilds', basename)
    const exists = await fileExists(filename)
    if (!exists) {
      await fsp.mkdir(path.dirname(filename), { recursive: true })
      await atomicWriteFile(filename, buffer)
    }

    this.prebuilds.set(dirname, './prebuilds/' + basename)
  }

  async warmup () {
    if (!this.entrypoint) {
      const pkg = await this.drive.get('/package.json')
      this.entrypoint = JSON.parse(pkg || '{}').main
      if (!this.entrypoint) this.entrypoint = 'index.js'
    }
    this.entrypoint = unixResolve('/', this.entrypoint)

    this.main = null

    for await (const dep of this.linker.dependencies(this.entrypoint, {}, new Set(), this.dependencies)) {
      if (!this.main) this.main = dep

      await this._savePrebuildToDisk(dep.module)
    }
  }

  start () {
    const self = this
    const nodeRequire = require.node || require
    const { cache } = this

    return run(this.main.module)

    function run (mod) {
      if (cache[mod.filename]) return cache[mod.filename].exports

      const m = cache[mod.filename] = {
        exports: {}
      }

      if (mod.type === 'json') {
        m.exports = JSON.parse(mod.source)
        return m.exports
      }

      require.cache = cache
      require.node = nodeRequire

      const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source) // eslint-disable-line no-new-func
      wrap(require, mod.dirname, mod.filename, m, m.exports)

      return m.exports

      function require (req) {
        if (builtins.has(req)) {
          return nodeRequire(req)
        }

        const output = resolve(mod, req)
        if (!output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

        if (req === 'node-gyp-build') return (dirname) => nodeRequire(path.resolve(self.cwd, self.prebuilds.get(unixResolve(dirname))))

        const dep = self.dependencies.get(output)
        return run(dep)
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
        type: mod.type,
        requires: {},
        source: mod.source
      }

      for (const r of mod.resolutions) {
        const isModule = builtins.has(r.input)

        if (isModule || !r.output) {
          dep.requires[r.input] = { output: r.output, shouldNodeRequire: isModule }
          continue
        }

        if (r.input === 'node-gyp-build') {
          dep.requires[r.input] = { output: this.prebuilds.get(mod.dirname) }
          continue
        }

        dep.requires[r.input] = { output: r.output }

        stack.push(this.dependencies.get(r.output))
      }
    }

    return dependencies
  }

  stringify () {
    const dependencies = this._bundleDeps(this.main.module)

    return `
    'use strict'

    const dependencies = ${JSON.stringify(dependencies, null, 2)}
    const nodeRequire = require

    run(dependencies['${this.main.module.filename}'])

    ${run.toString()}
    `.trim()

    // on purpose very similar to run() of start() to try re-use it
    function run (mod, cache = {}) {
      if (cache[mod.filename]) return cache[mod.filename].exports

      const m = cache[mod.filename] = {
        exports: {}
      }

      if (mod.type === 'json') {
        m.exports = JSON.parse(mod.source)
        return m.exports
      }

      require.cache = cache
      require.node = nodeRequire // eslint-disable-line no-undef

      const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', mod.source) // eslint-disable-line no-new-func
      wrap(require, mod.dirname, mod.filename, m, m.exports)

      return m.exports

      function require (req) {
        const r = mod.requires[req]

        if (r.shouldNodeRequire) {
          return nodeRequire(r.output) // eslint-disable-line no-undef
        }

        if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

        if (req === 'node-gyp-build') return () => nodeRequire(r.output) // eslint-disable-line no-undef

        const dep = dependencies[r.output]
        return run(dep, cache)
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

async function atomicWriteFile (filename, buffer) {
  const tmpfile = filename + '.tmp.' + Math.random()
  await fsp.writeFile(tmpfile, buffer, { flag: 'wx' })
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
