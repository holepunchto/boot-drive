const nodeRequire = require.node || require

let builtinModules = null
const builtins = {
  has (req) {
    if (builtinModules === null) builtinModules = nodeRequire('module').builtinModules || []
    return builtinModules.includes(req)
  },
  get (req) {
    return nodeRequire(req)
  },
  keys () {
    if (builtinModules === null) builtinModules = nodeRequire('module').builtinModules || []
    return builtinModules
  }
}

module.exports = { builtins }
