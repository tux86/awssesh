import { connect, type Socket } from "node:net";
import { encode, decodeStream, type ClientMessage, type DaemonMessage } from "./protocol";
import { socketPath, isDaemonAlive } from "./lifecycle";

export { isDaemonAlive };

/** Connect, send one message, resolve with the first reply, then close. */
export async function request(msg: ClientMessage, timeoutMs = 3000): Promise<DaemonMessage> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(socketPath());
    const dec = decodeStream<DaemonMessage>();
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("daemon request timed out"));
    }, timeoutMs);
    sock.once("connect", () => sock.write(encode(msg)));
    sock.on("data", (buf) => {
      const msgs = dec.push(buf.toString());
      if (msgs.length) {
        clearTimeout(timer);
        sock.destroy();
        const first = msgs[0];
        if (first.type === "error") {
          reject(new Error(first.message));
        } else {
          resolve(first);
        }
      }
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Open a subscription; call onState for every pushed message until stop() is called. */
export function subscribe(onState: (msg: DaemonMessage) => void): { stop: () => void } {
  const sock: Socket = connect(socketPath());
  const dec = decodeStream<DaemonMessage>();
  sock.once("connect", () => sock.write(encode({ type: "subscribe" })));
  sock.on("data", (buf) => {
    for (const msg of dec.push(buf.toString())) onState(msg);
  });
  sock.on("error", () => {});
  return { stop: () => sock.destroy() };
}
