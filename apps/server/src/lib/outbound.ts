import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Outbound HTTP for user-configured endpoints (ntfy, Gotify, webhooks) with SSRF protection:
 * - the target address is checked *after* DNS resolution, on the address actually connected to
 *   (no DNS-rebinding window),
 * - redirects are never followed,
 * - link-local (e.g. 169.254.169.254 cloud metadata), "this host", multicast and reserved ranges are always
 *   refused; loopback and private networks only when allowed (home servers often run ntfy locally),
 * - errors are reported generically so the feature cannot be used to map the internal network.
 */

const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
ALWAYS_BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS_BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addAddress('::', 'ipv6');
ALWAYS_BLOCKED.addSubnet('fe80::', 10, 'ipv6');
ALWAYS_BLOCKED.addSubnet('ff00::', 8, 'ipv6');

const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

export class OutboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundError';
  }
}

/** True when connecting to this IP address is not allowed. */
export function isBlockedAddress(address: string, allowPrivate: boolean): boolean {
  let ip = address;
  let family = isIP(ip);
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) {
    ip = mapped[1]!;
    family = 4;
  }
  if (family === 0) return true;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (ALWAYS_BLOCKED.check(ip, type)) return true;
  return !allowPrivate && PRIVATE.check(ip, type);
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses as { address: string; family: number }[];
      const ok = list.find((a) => !isBlockedAddress(a.address, allowPrivate));
      if (!ok || list.some((a) => isBlockedAddress(a.address, allowPrivate))) {
        return callback(new OutboundError('Destination not allowed'), '', 4);
      }
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [ok]);
      } else callback(null, ok.address, ok.family);
    });
  };
}

/** POSTs `body` and resolves with the status code. Never follows redirects. */
export function postOutbound(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: { allowPrivate: boolean; timeoutMs?: number },
): Promise<number> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Promise.reject(new OutboundError('Invalid URL'));
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return Promise.reject(new OutboundError('Only http(s) is supported'));
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host, opts.allowPrivate)) {
    return Promise.reject(new OutboundError('Destination not allowed'));
  }
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        lookup: guardedLookup(opts.allowPrivate),
        timeout: opts.timeoutMs ?? 8_000,
      },
      (res: IncomingMessage) => {
        res.resume(); // discard the body
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', () => reject(new OutboundError('Endpoint not reachable')));
      },
    );
    req.on('timeout', () => req.destroy(new OutboundError('Endpoint not reachable')));
    req.on('error', (err) =>
      reject(err instanceof OutboundError ? err : new OutboundError('Endpoint not reachable')),
    );
    req.end(body);
  });
}
