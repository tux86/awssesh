import { useEffect, useState, useCallback, useRef } from "react";
import { subscribe, request, isDaemonAlive } from "../../daemon/client.js";
import { spawnDetached } from "../../daemon/index.js";
import type { ProfileState, DaemonInfo, DaemonMessage } from "../../daemon/protocol.js";

export interface DaemonView {
  running: boolean;
  info: DaemonInfo | null;
  profiles: ProfileState[];
  startBackground: () => Promise<void>;
  refresh: (profile?: string) => Promise<void>;
  setFavorite: (profile: string, value: boolean) => Promise<void>;
}

export function useDaemon(localProfiles: ProfileState[]): DaemonView {
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState<DaemonInfo | null>(null);
  const [profiles, setProfiles] = useState<ProfileState[]>(localProfiles);
  const subRef = useRef<{ stop: () => void } | null>(null);

  const attach = useCallback(() => {
    subRef.current?.stop();
    subRef.current = subscribe((msg: DaemonMessage) => {
      if (msg.type === "state") {
        setInfo(msg.daemon);
        setProfiles(msg.profiles);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const alive = await isDaemonAlive();
      if (cancelled) return;
      setRunning(alive);
      if (alive) attach();
    })();
    return () => {
      cancelled = true;
      subRef.current?.stop();
      subRef.current = null;
    };
  }, [attach]);

  const startBackground = useCallback(async () => {
    await spawnDetached();
    const alive = await isDaemonAlive();
    setRunning(alive);
    if (alive) attach();
  }, [attach]);

  const refresh = useCallback(async (profile?: string) => {
    if (await isDaemonAlive()) {
      try {
        await request({ type: "refresh", profile });
      } catch {
        // Transient timeout or daemon error — ignore; subscription will deliver next update.
      }
    }
  }, []);

  const setFavorite = useCallback(async (profile: string, value: boolean) => {
    if (await isDaemonAlive()) {
      try {
        await request({ type: "setFavorite", profile, value });
      } catch {
        // Transient timeout or daemon error — ignore; subscription will deliver next update.
      }
    }
  }, []);

  return { running, info, profiles, startBackground, refresh, setFavorite };
}
