# circuitscan-pipeline-runner

The default export async function from the `main` file specified in `package.json` will be invoked.

Pipeline packages must have this package as a production dependency:

```
yarn add circuitscan-pipeline-runner
```

## Pipeline default export

`export default async function(event, { status })`

### Arguments

#### `event`

Includes a `payload` object key which is the input from the user's CLI.

#### `status`

Includes a synchronous `log(msg, data)` method for sending status updates to the user's CLI and website frontend build output.

```js
status.log('Reticulating Splines...', { splineLen: 123 });
```

### Return value

It should return the `pkgName` string on success or throw an error on failure.

## Standard library

Also includes a standard library for interacting with build artifacts and relaying compiler status.

Function Name | Arguments | Note
--------------|-----------|----------
`uniqueName` | `prefix` (string) | Add a suffix that contains an adjective, color, and animal to make the prefix unique
`execPromise` | `cmd` (string) | Node.js `fs.exec` promisified
`monitorProcessMemory` | `processName` (string), `timeout` (number), `callback` (function) | Callback invoked at interval, returns function that can be invoked to stop monitoring
`downloadBinaryFile` | `url` (string), `outputPath` (string) | Download file from HTTPS using streams
`uploadLargeFileToS3` | `keyName` (string), `filePath` (string), `logger` (object, optional) | Upload `filePath` to the artifact S3 bucket using streams. If specified, `logger` must have a `log(msg)` method.
`zipDirectory` | `sourceDir` (string), `outPath` (string), `logger` (object, optional) | Create a zip file of a directory. If specified, `logger` must have a `log(msg)` method.
`mkdirpSync` | `targetDir` (string) | Recreation of shell command `mkdir -p`

## License

MIT
