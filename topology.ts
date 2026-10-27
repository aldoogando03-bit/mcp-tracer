export type Device = { name: string; model: string; x: number; y: number };
export type Link = { dev1: string; port1: string; dev2: string; port2: string; cable: string };
export type IosConfig = { name: string; commands: string[] };
export type PcIp = { name: string; dhcp: boolean; ip?: string; mask?: string; gateway?: string; dns?: string };

export class Topology {
  devices = new Map<string, Device>();
  links: Link[] = [];
  configs = new Map<string, string[]>();
  pcIps = new Map<string, PcIp>();

  reset() {
    this.devices.clear();
    this.links = [];
    this.configs.clear();
    this.pcIps.clear();
  }

  addDevice(d: Device) {
    this.devices.set(d.name, d);
  }

  addLink(l: Link) {
    for (const n of [l.dev1, l.dev2]) {
      if (!this.devices.has(n)) throw new Error(`Dispositivo no existe: ${n}`);
    }
    this.links.push(l);
  }

  configureIos(c: IosConfig) {
    if (!this.devices.has(c.name)) throw new Error(`Dispositivo no existe: ${c.name}`);
    this.configs.set(c.name, [...(this.configs.get(c.name) ?? []), ...c.commands]);
  }

  configurePc(p: PcIp) {
    if (!this.devices.has(p.name)) throw new Error(`Dispositivo no existe: ${p.name}`);
    this.pcIps.set(p.name, p);
  }

  validate(): string[] {
    const issues: string[] = [];
    const used = new Set<string>();
    for (const l of this.links) {
      for (const [dev, port] of [[l.dev1, l.port1], [l.dev2, l.port2]]) {
        const key = `${dev}:${port}`;
        if (used.has(key)) issues.push(`Puerto usado dos veces: ${key}`);
        used.add(key);
      }
    }
    for (const name of this.devices.keys()) {
      const connected = this.links.some((l) => l.dev1 === name || l.dev2 === name);
      if (!connected) issues.push(`Dispositivo sin enlaces: ${name}`);
    }
    return issues;
  }

  toJSON() {
    return {
      devices: [...this.devices.values()],
      links: this.links,
      configs: Object.fromEntries(this.configs),
      pcIps: [...this.pcIps.values()],
    };
  }
}
