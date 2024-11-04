import https from 'node:https';
import {mkdirSync, createWriteStream, createReadStream, readFileSync} from 'node:fs';
import {isAbsolute, resolve, sep} from 'node:path';
import {exec} from 'node:child_process';
import nodeUrl from 'node:url';

import {S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';
import archiver from 'archiver';
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';

import {StatusReporter} from './src/StatusReporter.js';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

export async function pipelineWrapper(handler) {
  function saveResponse(requestId, obj) {
    return uploadJsonToS3(
      process.env.BLOB_BUCKET,
      `instance-response/${requestId}.json`,
      obj,
    );
  }
  const payload = JSON.parse(readFileSync(process.argv[2], {encoding:'utf8'}));
  const status = new StatusReporter(process.env.BLOB_BUCKET, `status/${payload.requestId}.json`);
  status.startUploading(5000);
  status.startMemoryLogs(10000);
  try {
    const pkgName = await handler({ payload }, { status });
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

export function uniqueName(prefix) {
  return `${prefix}-${uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: '-',
  })}`;
}

export function execPromise(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if(error) reject(error);
      else resolve({stderr, stdout});
    });
  });
}

export function monitorProcessMemory(processName, timeout, callback) {
  let cancel = false;
  let timeoutHandle = null;

  function getMemoryUsage() {
    exec(
      `ps aux | grep ${processName} | grep -v grep | awk '{sum += $6} END {print sum}'`,
      (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing command: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }

        const memoryUsage = parseInt(stdout.trim(), 10);
        if (isNaN(memoryUsage)) {
          return;
        }

        callback(memoryUsage);
        if(!cancel) timeoutHandle = setTimeout(getMemoryUsage, timeout);
      }
    );
  }

  timeoutHandle = setTimeout(getMemoryUsage, timeout);
  return function() {
    cancel = true;
    timeoutHandle && clearTimeout(timeoutHandle);
  }
}

export function downloadBinaryFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(outputPath);
    const request = https.get(url, {
      agent: new https.Agent({
        rejectUnauthorized: !url.startsWith('https://localhost:') // This allows self-signed certificates
      }),
    }, response => {
      // Check if the status code is a redirect (301, 302, 307, 308)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect by making a new request to the "location" header
        const redirectUrl = nodeUrl.resolve(url, response.headers.location);
        console.log(`Redirecting to: ${redirectUrl}`);
        resolve(downloadBinaryFile(redirectUrl, outputPath));
        return;
      } else if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: Status code ${response.statusCode}`));
        return;
      }

      // Pipe the response stream directly into the file stream
      response.pipe(file);
    });

    file.on('finish', () => {
      file.close();
      resolve(`File downloaded and saved to ${outputPath}`);
    });

    // Handle request errors
    request.on('error', err => {
      file.close();
      reject(err);
    });

    file.on('error', err => {
      file.close();
      // Attempt to delete the file in case of any error while writing to the stream
      unlink(outputPath, () => reject(err));
    });
  });
}

export async function uploadJsonToS3(bucketName, key, jsonObject) {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: JSON.stringify(jsonObject),
    ContentType: 'application/json'
  }));
}

export async function uploadLargeFileToS3(keyName, filePath, logger) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.BLOB_BUCKET,
      Key: keyName,
      Body: createReadStream(filePath),
    },
  });

  // Monitor progress
  upload.on('httpUploadProgress', (progress) => {
    logger && logger.log(`Uploaded ${progress.loaded} of ${progress.total} bytes`);
  });

  // Execute the upload
  const result = await upload.done();
  logger && logger.log('Upload complete:', result);
}

export function zipDirectory(sourceDir, outPath, logger) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', function() {
      logger && logger.log(archive.pointer() + ' total bytes');
      logger && logger.log('archiver has been finalized and the output file descriptor has closed.');
      resolve();
    });

    archive.on('error', function(err) {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export function mkdirpSync(targetDir) {
  const initDir = isAbsolute(targetDir) ? sep : '';
  const baseDir = '.';

  targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = resolve(baseDir, parentDir, childDir);
    try {
      mkdirSync(curDir);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

    return curDir;
  }, initDir);
}

export async function s3KeyExists(Bucket, Key) {
  try {
    const data = await s3Client.send(new HeadObjectCommand({
      Bucket, Key
    }));
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    } else {
      throw error;
    }
  }
  return true;
}

export async function deleteS3Keys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("Keys are required, and keys must be a non-empty array.");
  }

  const deleteParams = {
    Bucket: process.env.BLOB_BUCKET,
    Delete: {
      Objects: keys.map((key) => ({ Key: key })),
      Quiet: false,
    },
  };

  try {
    const data = await s3Client.send(new DeleteObjectsCommand(deleteParams));
  } catch (error) {
    console.error("Error deleting objects:", error);
    throw error;
  }
}

export class MockStatusReporter {
  constructor() {
    this.logs = [];
  }

  log(msg, data) {
    this.logs.push({
      msg,
      data,
      time: process.uptime(),
    });
  }
}
