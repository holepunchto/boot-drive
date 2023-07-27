'use strict'

const path = require('path')
const fsp = require('fs/promises')
const ScriptLinker = require('@holepunchto/script-linker')
const unixResolve = require('unix-path-resolve')
const { createBuiltins } = require('./defaults.js')

module.exports = class Boot {
  constructor (drive, opts = {}) {
    this.drive = drive
    this.cache = opts.cache || {}

    this.entrypoint = opts.entrypoint ? unixResolve('/', opts.entrypoint) : null
    this.dependencies = opts.dependencies || new Map()

    this.cwd = opts.cwd || '.'
    this.absolutePrebuilds = opts.absolutePrebuilds || false
    this.prebuilds = {}
    this.forceWarmup = !!opts.dependencies

    this.linker = new ScriptLinker(drive, {
      sourceOverwrites: opts.sourceOverwrites,
      builtins: createBuiltins(opts.additionalBuiltins)
    })

    this.platform = opts.platform || process.platform
    this.arch = opts.arch || process.arch

    this._isNode = opts.isNode !== undefined ? opts.isNode : !!process.versions.node
  }

  async _savePrebuildToDisk (mod) {
    const hasBuilds = resolve(mod, 'node-gyp-build')
    if (!hasBuilds) return

    const pkg = await mod.loadPackage()
    const runtime = this._isNode ? 'node' : 'bare'
    let current = await getCurrentPrebuild(pkg, this.cwd, runtime)
    let dirname = mod.dirname

    if (!current) {
      let buffer = null

      while (true) {
        const folder = dirname + '/prebuilds/' + this.platform + '-' + this.arch
        const prebuild = await findPrebuild(this.drive, folder, runtime)

        buffer = await this.drive.get(prebuild)
        if (buffer) {
          current = prebuildFile(pkg, this.cwd, path.extname(prebuild))
          break
        }

        if (dirname === '/') return
        dirname = unixResolve(dirname, '..')
      }

      await fsp.mkdir(path.dirname(current.filename), { recursive: true })
      await atomicWriteFile(current.filename, buffer)
    }

    this.prebuilds[dirname] = current.basename
  }

  async _defaultEntrypoint () {
    const pkg = await this.drive.get('/package.json')
    const main = JSON.parse(pkg || '{}').main || 'index.js'
    return unixResolve('/', main)
  }

  async warmup (entrypoint) {
    if (!this.entrypoint) this.entrypoint = await this._defaultEntrypoint()
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    if (this.forceWarmup === false && this.dependencies.has(entrypoint)) return

    for await (const dep of this.linker.dependencies(entrypoint, {}, new Set(), this.dependencies)) {
      await this._savePrebuildToDisk(dep.module)
    }
  }

  start (entrypoint) {
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    const main = this.dependencies.get(entrypoint)
    const boot = {
      cwd: this.cwd,
      absolutePrebuilds: true,
      prebuilds: this.prebuilds,
      dependencies: this._bundleDeps(main),
      entrypoint,
      cache: this.cache,
      createRequire,
      builtinRequire: require.builtinRequire || require
    }

    return run(run, boot, boot.dependencies[boot.entrypoint])
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

  stringify (entrypoint) {
    entrypoint = entrypoint ? unixResolve('/', entrypoint) : this.entrypoint

    const main = this.dependencies.get(entrypoint)
    const dependencies = this._bundleDeps(main)

    return `
    (function () {
      'use strict'

      const __BOOTDRIVE__ = {
        cwd: ${JSON.stringify(this.absolutePrebuilds ? this.cwd : null)},
        absolutePrebuilds: ${JSON.stringify(this.absolutePrebuilds)},
        prebuilds: ${JSON.stringify(this.prebuilds, null, 2)},
        dependencies: ${JSON.stringify(dependencies, null, 2)},
        entrypoint: ${JSON.stringify(entrypoint)},
        cache: {},
        createRequire: __BOOTDRIVE_CREATE_REQUIRE__,
        builtinRequire: require.builtinRequire || require
      }

      return __BOOTDRIVE_RUN__(__BOOTDRIVE_RUN__, __BOOTDRIVE__, __BOOTDRIVE__.dependencies[__BOOTDRIVE__.entrypoint])

      ${run.toString().replace('run', '__BOOTDRIVE_RUN__')}

      ${createRequire.toString().replace('createRequire', '__BOOTDRIVE_CREATE_REQUIRE__')}
    })()
    `.trim()
  }
}

function run (run, ctx, mod) {
  if (ctx.cache[mod.filename]) return ctx.cache[mod.filename].exports

  const m = ctx.cache[mod.filename] = mod

  if (mod.type === 'json') {
    m.exports = JSON.parse(mod.source)
    return m.exports
  }

  const require = ctx.createRequire(run, ctx, mod)
  require.main = ctx.cache[ctx.entrypoint]
  require.cache = ctx.cache
  require.builtinRequire = ctx.builtinRequire

  const source = mod.source + '\n//# sourceURL=' + mod.filename
  const wrap = new Function('require', '__dirname', '__filename', 'module', 'exports', source) // eslint-disable-line no-new-func
  wrap(require, mod.dirname, mod.filename, m, m.exports, source)

  return m.exports
}

function createRequire (run, ctx, mod) {
  const path = ctx.builtinRequire('path')

  return function (req) {
    if (req === 'node-gyp-build') {
      return function (dirname) {
        const prebuild = ctx.absolutePrebuilds ? path.resolve(ctx.cwd, 'prebuilds', ctx.prebuilds[dirname]) : './prebuilds/' + ctx.prebuilds[dirname]
        return ctx.builtinRequire(prebuild)
      }
    }

    const r = mod.requires[req]

    if (r.isBuiltin) {
      return ctx.builtinRequire(r.output)
    }

    if (!r.output) throw new Error('Could not resolve ' + req + ' from ' + mod.dirname)

    const dep = ctx.dependencies[r.output]
    return run(run, ctx, dep)
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

function prebuildFile (pkg, cwd, extension) {
  const basename = pkg.name.replace(/\//g, '+') + '@' + pkg.version + '.' + extension
  const filename = path.resolve(cwd, 'prebuilds', basename)
  return { basename, filename }
}

async function getCurrentPrebuild (pkg, cwd, runtime) {
  const extensions = runtime === 'node' ? ['node'] : ['bare', 'node']

  for (const extension of extensions) {
    const current = prebuildFile(pkg, cwd, extension)

    const exists = await fileExists(current.filename)
    if (exists) return current
  }

  return null
}

async function findPrebuild (drive, folder, runtime) {
  let prebuildNode = null

  for await (const name of drive.readdir(folder)) {
    if (runtime === 'bare' && name.endsWith('.bare')) {
      return unixResolve(folder, name)
    }

    if (prebuildNode === null && name.endsWith('.node')) {
      prebuildNode = unixResolve(folder, name)
      if (runtime === 'node') return prebuildNode
    }
  }

  return prebuildNode
}
