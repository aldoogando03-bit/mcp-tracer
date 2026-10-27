/** IPv4 helpers shared by topology.ts, validate.ts and prompts.ts: parse, format, masks and prefixes. Pure, no MCP imports. */

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
/** Dotted quad, each octet 0-255 without leading zeros. */
export const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

/** 32-bit value of a dotted quad that already passed IPV4. */
export const ipToInt = (s: string) => s.split(".").reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);

/** 32-bit value of a dotted-quad address (surrounding spaces ignored), or undefined. */
export function parseIpv4(s: string | undefined): number | undefined {
  const v = s?.trim() ?? "";
  return IPV4.test(v) ? ipToInt(v) : undefined;
}

export const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

/** 32-bit mask for a prefix length 0-32. */
export const prefixToInt = (p: number) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);

export const prefixToMask = (p: number) => intToIp(prefixToInt(p));

/** Prefix length of a 32-bit mask, or undefined when its 1-bits are not contiguous. */
export function maskToPrefix(mask: number): number | undefined {
  const inv = ~mask >>> 0;
  return (inv & (inv + 1)) === 0 ? 32 - Math.log2(inv + 1) : undefined;
}
