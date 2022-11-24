# boot

Boot a hyperdrive from memory.

```
npm i boot-drive
```

## Usage
```js
const Boot = require('boot-drive')

const boot = new Boot(drive)
await boot.warmup()

boot.start()
```

## API

#### `const boot = new Boot(drive, [options])`

Creates a bootloader to run the drive.

Available `options`:
```js
{
  entrypoint: null,
  modules: [],
  prebuildsPath: 'prebuilds'
}
```

`modules` is used to add more native modules.\
`prebuildsPath` is where binding prebuilds are stored (default: `./prebuilds`).

#### `boot.modules`

List of modules that are included in the boot process.\
By default it contains all the native modules.

Add more by `boot.modules.add(name)` or using `options` from the constructor.

#### `await boot.warmup()`

Prepares the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then it will use `index.js` by default.

#### `const exports = boot.start()`

Runs the drive.

## License
MIT
