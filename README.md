# boot-drive

Run an app from a Hyperdrive or Localdrive.

```
npm i boot-drive
```

## Usage

First prepare the drive
```js
const Boot = require('boot-drive')

const boot = new Boot(drive)
await boot.warmup()
```

Then you can start it
```js
const exported = boot.start()
console.log(exported)
```

Or you could just bundle it
```js
const source = boot.stringify()
console.log(source) // eval(source) or save it into a file
```

## API

#### `const boot = new Boot(drive, [options])`

Creates a bootloader to run the drive.

Available `options`:
```js
{
  entrypoint: 'index.js', // Default main file to be run at start
  cwd: '.', // Working directory for `prebuilds/`
  absolutePrebuilds: false, // If `true`, will use `cwd` for the prebuilds path, included on the stringified output
  cache: {}, // Used at runtime for `require.cache`, you can share it between boots
  dependencies: new Map(), // Used in `warmup()`, you can share linker deps between boots
  additionalBuiltins: [], // For adding modules to be imported by Node's native `require`
  sourceOverwrites: {} // Key/Value object where you can map filenames to source code
}
```

Without `absolutePrebuilds` native modules has to always be in `./prebuilds/` related to the execution or source file.

When running a drive, there is `require.builtinRequire` provided by the JS runtime itself.

#### `await boot.warmup()`

Prepares the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then it will use `index.js` by default.

#### `const exports = boot.start()`

Runs the drive.

#### `const source = boot.stringify()`

Bundles and stringifies the dependencies and source code of the drive.

## License

Apache-2.0
