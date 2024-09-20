#!/usr/bin/env node
import {readFileSync} from 'node:fs';

import {uploadJsonToS3} from './index.js';
import {StatusReporter} from './src/StatusReporter.js';

import circomPipeline from './index.js';

async function pipelineWrapper() {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const module = await import('./' + packageJson.main);
  const payload = JSON.parse(readFileSync(process.argv[2], {encoding:'utf8'}));
  const status = new StatusReporter(process.env.BLOB_BUCKET, `status/${payload.requestId}.json`);
  status.startUploading(5000);
  status.startMemoryLogs(10000);
  try {
    const pkgName = await circomPipeline({ payload }, { status });
    await saveResponse({
      statusCode: 200,
      body: JSON.stringify({
        pkgName,
      }),
    });
  } catch(error) {
    status.log(error.toString());
    await saveResponse({
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

function saveResponse(requestId, obj) {
  return uploadJsonToS3(
    process.env.BLOB_BUCKET,
    `instance-response/${requestId}.json`,
    obj,
  );
}
