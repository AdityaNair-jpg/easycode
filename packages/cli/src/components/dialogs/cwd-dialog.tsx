import { useCallback, useEffect, useMemo, useState } from "react";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { useNavigate } from "react-router";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { apiClient } from "../../lib/api-client";
import { DialogSearchList } from "../dialog-search-list";

const MAX_RECENT_PROJECTS = 5;
const IGNORED_DIRECTORIES = new Set(["node_modules"]);
type Entry =
  | { kind: "use"; path: string }
  | { kind: "recent"; path: string }
  | { kind: "parent"; path: string }
  | { kind: "child"; path: string };

function getLabel(entry: Entry) {
  switch (entry.kind) {
    case "use":
      return ` ✓ Use this folder — ${entry.path}`;
    case "recent":
      return ` ↩ ${entry.path}`;
    case "parent":
      return ` ..`;
    case "child":
      return ` ${basename(entry.path)}/`;
  }
}

export const CwdDialogContent = () => {
  const [directory, setDirectory] = useState(() => process.cwd());
  const [subdirectories, setSubdirectories] = useState<string[]>([]);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const { close } = useDialog();
  const { show } = useToast();
  const navigate = useNavigate();

  // Subdirectories of whatever folder is currently being browsed
  useEffect(() => {
    let ignore = false;

    const listSubdirectories = async () => {
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        if (ignore) return;

        setSubdirectories(
          entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith(".") &&
                !IGNORED_DIRECTORIES.has(entry.name),
            )
            .map((entry) => join(directory, entry.name))
            .sort((left, right) => left.localeCompare(right)),
        );
      } catch {
        if (!ignore) setSubdirectories([]);
      }
    };

    listSubdirectories();

    return () => {
      ignore = true;
    };
  }, [directory]);

  // Folders of past sessions, newest first — recents are a convenience, so a
  // failed fetch just leaves the browser without them.
  useEffect(() => {
    let ignore = false;

    const fetchRecentProjects = async () => {
      try {
        const res = await apiClient.sessions.$get();
        if (!res.ok || ignore) return;

        const sessions = await res.json();
        if (ignore) return;

        const seen = new Set<string>();
        const directories: string[] = [];

        for (const session of sessions) {
          const sessionCwd = session.cwd;
          if (!sessionCwd || seen.has(sessionCwd)) continue;

          seen.add(sessionCwd);
          if (existsSync(sessionCwd)) directories.push(sessionCwd);
          if (directories.length >= MAX_RECENT_PROJECTS) break;
        }

        setRecentProjects(directories);
      } catch {
        // Ignored on purpose — see comment above
      }
    };

    fetchRecentProjects();

    return () => {
      ignore = true;
    };
  }, []);

  const items = useMemo<Entry[]>(() => {
    const entries: Entry[] = [{ kind: "use", path: directory }];

    for (const project of recentProjects) {
      if (project !== directory) entries.push({ kind: "recent", path: project });
    }

    const parent = dirname(directory);
    if (parent !== directory) entries.push({ kind: "parent", path: parent });

    for (const subdirectory of subdirectories) {
      entries.push({ kind: "child", path: subdirectory });
    }

    return entries;
  }, [directory, recentProjects, subdirectories]);

  const handleSelect = useCallback(
    (entry: Entry) => {
      // Browsing moves the list; only "use" and "recent" commit the change
      if (entry.kind === "parent" || entry.kind === "child") {
        setDirectory(entry.path);
        return;
      }

      try {
        process.chdir(entry.path);
      } catch {
        show({ variant: "error", message: `Could not switch to ${entry.path}` });
        return;
      }

      close();
      show({ variant: "success", message: `Project folder: ${process.cwd()}` });
      // Back to Home so the next session is created in the new folder
      navigate("/");
    },
    [close, navigate, show],
  );

  return (
    <DialogSearchList
      // Remounting on navigation clears the stale query and selection
      key={directory}
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) => getLabel(item).toLowerCase().includes(query.toLowerCase())}
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {getLabel(item)}
        </text>
      )}
      getKey={(item) => `${item.kind}:${item.path}`}
      placeholder="Search folders"
      emptyText="No matching folders"
    />
  );
};
