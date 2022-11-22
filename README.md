# boot

Boot a hyperdrive from memory.

```
npm i holepunchto/boot
```

## Usage
```js
const boot = new Boot(drive)
await boot.start()
```

## API

#### `const boot = new Boot(drive, [options])`

Creates a bootloader to run the drive.

Available `options`:
```js
{
  modules: [],
  prebuildsPath: 'prebuilds'
}
```

`modules` is used to add more native modules.
`prebuildsPath` is where binding prebuilds are stored (default: `./prebuilds`).

#### `drive.modules`

List of modules that are included in the boot process.\
By default it contains all the native modules.

Add more by `drive.modules.add(name)` or using `options` from the constructor.

#### `await drive.start([entrypoint])`

Runs the drive.

If `entrypoint` is not set, then it will try `/package.json` `main` property.

If it fails to find an `entrypoint` then the boot process will fail.

## License
MIT
