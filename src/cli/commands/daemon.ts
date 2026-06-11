import { spawnDetached } from "../../daemon/index";
import { request, isDaemonAlive } from "../../daemon/client";
import { readPidFile } from "../../daemon/lifecycle";

export async function runDaemonCommand(sub: string | undefined): Promise<number> {
  switch (sub) {
    case "start": {
      if (await isDaemonAlive()) {
        process.stdout.write("daemon already running\n");
        return 0;
      }
      await spawnDetached();
      process.stdout.write(
        (await isDaemonAlive()) ? "daemon started\n" : "failed to start daemon (see ~/.aws/ssomatic/daemon.log)\n"
      );
      return 0;
    }
    case "stop": {
      if (!(await isDaemonAlive())) {
        process.stdout.write("daemon not running\n");
        return 0;
      }
      await request({ type: "stop" }).catch(() => {});
      process.stdout.write("daemon stopped\n");
      return 0;
    }
    case "status":
    case undefined: {
      if (!(await isDaemonAlive())) {
        process.stdout.write("daemon: stopped\n");
        return 0;
      }
      const msg = await request({ type: "snapshot" });
      const pid = readPidFile();
      const watched =
        msg.type === "state"
          ? msg.profiles.filter((p) => p.favorite).map((p) => p.name)
          : [];
      process.stdout.write(
        `daemon: running (pid ${pid ?? "?"})\nwatching: ${watched.join(", ") || "(none)"}\n`
      );
      return 0;
    }
    default:
      process.stderr.write(`unknown daemon subcommand: ${sub}\n`);
      return 1;
  }
}
