const builtinRequire = require.builtin || require

function createBuiltins (additionalBuiltins) {
  let builtins = null

  return {
    has (req) {
      if (builtins === null) builtins = getBuiltins(additionalBuiltins)
      return builtins.includes(req)
    },
    get (req) {
      return builtinRequire(req)
    },
    keys () {
      if (builtins === null) builtins = getBuiltins(additionalBuiltins)
      return builtins
    }
  }
}

module.exports = { createBuiltins }

function getBuiltins (additionalBuiltins) {
  const builtinModules = builtinRequire('module').builtinModules || []
  return builtinModules.concat(additionalBuiltins || [])
}
