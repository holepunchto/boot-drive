const builtinRequire = require.builtin || require

function createBuiltins (additionalBuiltins) {
  let builtinModules = null

  return {
    has (req) {
      if (builtinModules === null) builtinModules = getBuiltins(additionalBuiltins)
      return getBuiltins(additionalBuiltins).includes(req)
    },
    get (req) {
      return builtinRequire(req)
    },
    keys () {
      if (builtinModules === null) builtinModules = getBuiltins(additionalBuiltins)
      return getBuiltins(additionalBuiltins)
    }
  }
}

module.exports = { createBuiltins }

function getBuiltins (additionalBuiltins) {
  return (builtinRequire('module').builtinModules || []).concat(additionalBuiltins || [])
}
