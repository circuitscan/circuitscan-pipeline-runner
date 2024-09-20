# circuitscan-pipeline-runner

Pipeline packages must have this package as a production dependency:

```
yarn add circuitscan-pipeline-runner
```

## Pipeline default export

The default export async function from the `main` file specified in `package.json` on your pipeline package will be invoked.

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

It should return the `pkgName` string on success or throw an error on failure. This package name should have a suffix appended by the `uniqueName()` function.

During its operation, the pipeline package should upload a file at `build/<pkgName>/info.json` (using `uploadLargeFileToS3()`) containing the necessary data to display the information about the circuit. Other build artifacts should also go in this directory.

## Standard library

Also includes a standard library for interacting with build artifacts and relaying compiler status.

Function Name | Arguments | Note
--------------|-----------|----------
`uniqueName` | `prefix` (string) | Add a suffix that contains an adjective, color, and animal to make the prefix unique
`execPromise` | `cmd` (string) | Node.js `fs.exec` promisified
`monitorProcessMemory` | <ul><li>`processName` (string)</li><li>`timeout` (number)</li><li>`callback` (function)</li></ul> | Callback invoked at interval, returns function that can be invoked to stop monitoring
`downloadBinaryFile` | <ul><li>`url` (string)</li><li>`outputPath` (string)</li></ul> | Download file from HTTPS using streams
`uploadLargeFileToS3` | <ul><li>`keyName` (string)</li><li>`filePath` (string)</li><li>`logger` (object, optional)</li></ul> | Upload `filePath` to the artifact S3 bucket using streams. If specified, `logger` must have a `log(msg)` method.
`zipDirectory` | <ul><li>`sourceDir` (string)</li><li>`outPath` (string)</li><li>`logger` (object, optional)</li></ul> | Create a zip file of a directory. If specified, `logger` must have a `log(msg)` method.
`mkdirpSync` | `targetDir` (string) | Recreation of shell command `mkdir -p`

## Barebones Example

```js
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
    execPromise,
    monitorProcessMemory,
    uniqueName,
    uploadLargeFileToS3,
} from 'circuitscan-pipeline-runner';

export default async function(event, { status }) {
    // TODO ... input validation ...

    const pkgName = uniqueName(circuitName);
    const dirPkg = join(tmpdir(), pkgName);

    const compilePromise = execPromise(`gcc foo.c`);
    const cancelMemoryMonitor = monitorProcessMemory(
      'gcc',
      10000,
      memoryUsage => {
        status.log(`Compiler memory usage`, { memoryUsage });
      }
    );
    await compilePromise;
    cancelMemoryMonitor();

    writeFileSync(join(dirPkg, 'info.json'), JSON.stringify({
      requestId: event.payload.requestId,
      type: 'mypipeline',
      importantProperty: 123,
      foo: 'bar',
    }, null, 2));
    await uploadLargeFileToS3(`build/${pkgName}/info.json`, join(dirPkg, 'info.json'));

    return pkgName;
}
```

## See Also

* [Circuitscan Circom Pipeline repository](https://github.com/circuitscan/circom-pipeline)

## License

MIT
