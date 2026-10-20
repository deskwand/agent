import { generateKeyPairSync } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export interface AppKey {
  privateKeyPath: string;
  publicKey: string;
}

const PRIVATE_NAME = "deskwand_rsa";

function lenPrefix(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
}

/** SSH wire format 的 mpint：去掉前导零，最高位为 1 时补一个 0 字节。 */
function mpint(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  const body = buf.subarray(i);
  return body[0] & 0x80 ? Buffer.concat([Buffer.from([0]), body]) : body;
}

/** 由 RSA 公钥的 JWK 生成 OpenSSH 公钥串（不依赖 ssh-keygen）。 */
export function sshRsaPublicKey(nB64Url: string, eB64Url: string): string {
  const wire = Buffer.concat([
    lenPrefix(Buffer.from("ssh-rsa")),
    lenPrefix(mpint(Buffer.from(eB64Url, "base64url"))),
    lenPrefix(mpint(Buffer.from(nB64Url, "base64url"))),
  ]);
  return `ssh-rsa ${wire.toString("base64")} deskwand`;
}

export function ensureAppKey(dir: string): AppKey {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const privateKeyPath = join(dir, PRIVATE_NAME);
  const publicKeyPath = `${privateKeyPath}.pub`;
  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    return {
      privateKeyPath,
      publicKey: readFileSync(publicKeyPath, "utf8").trim(),
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
  });
  const jwk = publicKey.export({ format: "jwk" });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  writeFileSync(privateKeyPath, pem, { mode: 0o600 });
  chmodSync(privateKeyPath, 0o600);
  const sshKey = sshRsaPublicKey(jwk.n as string, jwk.e as string);
  writeFileSync(publicKeyPath, `${sshKey}\n`, { mode: 0o644 });
  return { privateKeyPath, publicKey: sshKey };
}
