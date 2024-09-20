import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {uploadJsonToS3} from './index.js';
import {StatusReporter} from './src/StatusReporter.js';

async function pipelineWrapper() {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const mainFile = resolve(process.cwd(), packageJson.main);
  const module = await import(mainFile);
  const payload = JSON.parse(readFileSync(process.argv[2], {encoding:'utf8'}));
  const status = new StatusReporter(process.env.BLOB_BUCKET, `status/${payload.requestId}.json`);
  status.startUploading(5000);
  status.startMemoryLogs(10000);
  try {
    const pkgName = await module.default({ payload }, { status });
    await saveResponse(payload.requestId, {
      statusCode: 200,
      body: JSON.stringify({
        pkgName,
      }),
    });
  } catch(error) {
    status.log(error.toString());
    await saveResponse(payload.requestId, {
      statusCode: 500,
      body: JSON.stringify({
        errorType: 'error',
        errorMessage: error.message
      }),
    });
  } finally {
    status.stopMemoryLogs();
    await status.stopUploading();
  }
}

// Invoke immediately
pipelineWrapper();

function saveResponse(requestId, obj) {
  return uploadJsonToS3(
    process.env.BLOB_BUCKET,
    `instance-response/${requestId}.json`,
    obj,
  );
}
