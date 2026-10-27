import { Topology } from "./topology.js";

/** Per-server state. Tools must read `session.topology` on every call (load/build swap it). */
export class Session {
  topology = new Topology();

  replaceTopology(t: Topology) {
    this.topology = t;
  }
}
