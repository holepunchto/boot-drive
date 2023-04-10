'use strict'

const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('script-linker')
const sodium = require('sodium-native')
const b4a = require('b4a')
const unixResolve = require('unix-path-resolve')
const { createBuiltins } = require('./defaults.js')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.cache = opts.cache || {}

    this.entrypoint = opts.entrypoint || null
    this.main = null
    this.dependencies = opts.dependencies || new Map()

    this.cwd = opts.cwd || '.'
    this.absolutePrebuilds = opts.absolutePrebuilds || false
    this.prebuilds = {}

    this.linker = new ScriptLinker({
      readFile: async (name) => {
        if (opts.sourceOverwrites && Object.hasOwn(opts.sourceOverwrites, name)) {
          return opts.sourceOverwrites[name]
        }

        const buffer = await this.drive.get(name)
        if (!buffer) throw new Error('ENOENT: ' + name)
        return buffer
      },
      builtins: createBuiltins(opts.additionalBuiltins)
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

    this.prebuilds[dirname] = this.absolutePrebuilds ? filename : './prebuilds/' + basename
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
    const boot = {
      prebuilds: this.prebuilds,
      dependencies: this._bundleDeps(this.main.module),
      entrypoint: this.main.module.filename,
      cache: this.cache,
      createRequire: this._createRequire,
      builtinRequire: require.builtinRequire || require
    }

    return this._run(this._run, boot, boot.dependencies[boot.entrypoint])
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
        source: mod.source,
        exports: {}
      }

      for (const r of mod.resolutions) {
        if (r.input === 'node-gyp-build') continue

        const isBuiltin = this.linker.builtins.has(r.input)

        if (isBuiltin || !r.output) {
          dep.requires[r.input] = { output: r.output, isBuiltin }
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
    (function () {
      'use strict'

      const __BOOTDRIVE__ = {
        prebuilds: ${JSON.stringify(this.prebuilds, null, 2)},
        dependencies: ${JSON.stringify(dependencies, null, 2)},
        entrypoint: ${JSON.stringify(this.main.module.filename)},
        cache: {},
        createRequire: __BOOTDRIVE_CREATE_REQUIRE__,
        builtinRequire: require.builtinRequire || require
      }

      return __BOOTDRIVE_RUN__(__BOOTDRIVE_RUN__, __BOOTDRIVE__, __BOOTDRIVE__.dependencies[__BOOTDRIVE__.entrypoint])

      function ${this._run.toString().replace('_run', '__BOOTDRIVE_RUN__')}

      function ${this._createRequire.toString().replace('_createRequire', '__BOOTDRIVE_CREATE_REQUIRE__')}
    })()
    `.trim()
  }

  _run (run, { dependencies, prebuilds, entrypoint, cache, createRequire, builtinRequire }, mod) {
    if (cache[mod.filename]) return cache[mod.filename].exports

    const m = cache[mod.filename] = mod

    if (mod.type === 'json') {
      m.exports = JSON.parse(mod.source)
      return m.exports
    }

    const require = createRequire(run, { dependencies, prebuilds, entrypoint, cache, createRequire, builtinRequire }, mod)
    require.main = cache[entrypoint]
    require.cache = cache
    require.builtinRequire = builtinRequire

    const source = mod.source + '\n//# sourceURL=' + mod.filename
    const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', source) // eslint-disable-line no-new-func
    wrap(require, mod.dirname, mod.filename, m, m.exports, source)

    return m.exports
  }

  _createRequire (run, { dependencies, prebuilds, entrypoint, cache, createRequire, builtinRequire }, mod) {
    return function (req) {
      if (req === 'node-gyp-build') {
        return (dirname) => builtinRequire(prebuilds[dirname])
      }

      const r = mod.requires[req]

      if (r.isBuiltin) {
        return builtinRequire(r.output)
      }

      if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

      const dep = dependencies[r.output]
      return run(run, { dependencies, prebuilds, entrypoint, cache, createRequire, builtinRequire }, dep)
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
