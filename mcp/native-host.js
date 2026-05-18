#!/usr/bin/env node
// Native messaging host — receives transcripts from Chrome extension, writes to disk

import fs from 'fs';
import path from 'path';
import os from 'os';

const TRANSCRIPTS_DIR = path.join(os.homedir(), '.meet-transcriber', 'transcripts');

function ensureDir() {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
}

function readMessage() {
  return new Promise((resolve, reject) => {
    let lenBuf = Buffer.alloc(0);

    function onReadable() {
      while (lenBuf.length < 4) {
        const chunk = process.stdin.read(4 - lenBuf.length);
        if (!chunk) return;
        lenBuf = Buffer.concat([lenBuf, chunk]);
      }

      const msgLen = lenBuf.readUInt32LE(0);
      let msgBuf = Buffer.alloc(0);

      function readBody() {
        while (msgBuf.length < msgLen) {
          const chunk = process.stdin.read(msgLen - msgBuf.length);
          if (!chunk) return;
          msgBuf = Buffer.concat([msgBuf, chunk]);
        }
        process.stdin.removeListener('readable', readBody);
        try {
          resolve(JSON.parse(msgBuf.toString('utf-8')));
        } catch (e) {
          reject(e);
        }
      }

      process.stdin.removeListener('readable', onReadable);
      process.stdin.on('readable', readBody);
      readBody();
    }

    process.stdin.on('readable', onReadable);
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lenBuf);
  process.stdout.write(buf);
}

async function main() {
  ensureDir();

  try {
    const msg = await readMessage();

    if (msg.type === 'SAVE_TRANSCRIPT') {
      const t = msg.transcript;
      const filePath = path.join(TRANSCRIPTS_DIR, t.id + '.json');
      fs.writeFileSync(filePath, JSON.stringify(t, null, 2), 'utf-8');
      sendMessage({ success: true, path: filePath });
    } else if (msg.type === 'DELETE_TRANSCRIPT') {
      const filePath = path.join(TRANSCRIPTS_DIR, msg.id + '.json');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      sendMessage({ success: true });
    } else if (msg.type === 'PING') {
      sendMessage({ success: true, version: '0.1.0' });
    } else {
      sendMessage({ error: 'Unknown message type: ' + msg.type });
    }
  } catch (e) {
    sendMessage({ error: e.message });
  }
}

main();
