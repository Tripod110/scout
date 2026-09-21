// Run once, locally: node worker/scripts/generate-vapid-keys.mjs
//
// Prints exactly what the two halves of the setup need:
//   - VAPID_PUBLIC_KEY  -> paste into worker/wrangler.toml [vars]
//   - VAPID_PRIVATE_KEY -> pipe into `wrangler secret put VAPID_PRIVATE_KEY`
//
// Uses Node's built-in Web Crypto (no dependency) so the key format matches
// exactly what worker/src/webpush.js expects to import at request time.
import { webcrypto } from 'node:crypto';

function bytesToB64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));
const privateJwk = await webcrypto.subtle.exportKey('jwk', privateKey);

console.log('VAPID_PUBLIC_KEY (paste into worker/wrangler.toml [vars]):\n');
console.log(bytesToB64url(publicRaw));
console.log('\nVAPID_PRIVATE_KEY (pipe into `wrangler secret put VAPID_PRIVATE_KEY`):\n');
console.log(JSON.stringify(privateJwk));
console.log('\nExample:\n  node worker/scripts/generate-vapid-keys.mjs > /tmp/vapid.txt');
console.log('  # copy the public key line into wrangler.toml, then:');
console.log('  wrangler secret put VAPID_PRIVATE_KEY   # paste the JWK line when prompted');
