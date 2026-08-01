import { createHash } from 'node:crypto';

const token = process.argv[2];

if (!token) {
  console.error('Usage: npm run hash-token -- <token>');
  process.exit(1);
}

console.log(createHash('sha256').update(token).digest('hex'));
