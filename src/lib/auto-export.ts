// Nightly archive delivery on the superadmin dashboard.
//
// Every new data_exports row (written by run_nightly_archive at 00:00 Nairobi)
// is delivered through two sinks:
//   1. The browser download — always available, lands in the Downloads folder.
//   2. An optional device folder picked once through the File System Access
//      API. The handle persists in IndexedDB and new exports are written into
//      it silently, so the superadmin's own disk copy appears without prompts.
//
// Files are delivered as .xlsx workbooks so they open directly in Excel.

import * as XLSX from "xlsx";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const REMEMBER_KEY = "kh-auto-export-ids";
const SEEN_KEY = "kh-auto-export-seeded";
const HANDLE_DB = "kh-auto-export";
const HANDLE_STORE = "handles";
const REMEMBER_LIMIT = 500;

type StoredHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

function rememberedIds(): string[] {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isExportHandled(id: string): boolean {
  return rememberedIds().includes(id);
}

export function markExportHandled(id: string): void {
  const ids = rememberedIds().filter((x) => x !== id);
  ids.unshift(id);
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(ids.slice(0, REMEMBER_LIMIT)));
  } catch {
    /* storage full — delivery already happened */
  }
}

/**
 * First run of the feature: everything already in the archive predates
 * auto-delivery, so mark it seen without downloading a burst of old files.
 * Returns true when this call performed the seed.
 */
export function seedExportsIfNeeded(ids: string[]): boolean {
  if (localStorage.getItem(SEEN_KEY) === "1") return false;
  const merged = Array.from(new Set([...rememberedIds(), ...ids])).slice(0, REMEMBER_LIMIT);
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(merged));
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
  return true;
}

export function folderPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as Error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error as Error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as Error);
  });
}

export async function loadFolderHandle(): Promise<StoredHandle | null> {
  try {
    return await idbGet<StoredHandle>("dir");
  } catch {
    return null;
  }
}

export async function forgetFolder(): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete("dir");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as Error);
  });
}

export type AutoSaveStatus =
  | { kind: "unsupported" }
  | { kind: "off" }
  | { kind: "needs-permission" }
  | { kind: "on"; name: string };

async function ensurePermission(handle: StoredHandle): Promise<boolean> {
  try {
    if (!handle.queryPermission || !handle.requestPermission) return true;
    const descriptor = { mode: "readwrite" };
    if ((await handle.queryPermission(descriptor)) === "granted") return true;
    // May reject when called without a user gesture — treat as not granted.
    return (await handle.requestPermission(descriptor)) === "granted";
  } catch {
    return false;
  }
}

export async function getAutoSaveStatus(): Promise<AutoSaveStatus> {
  if (!folderPickerSupported()) return { kind: "unsupported" };
  const handle = await loadFolderHandle();
  if (!handle) return { kind: "off" };
  return (await ensurePermission(handle)) ? { kind: "on", name: handle.name } : { kind: "needs-permission" };
}

/** Opens the folder picker and remembers the choice. Null = cancelled/failed. */
export async function pickExportFolder(): Promise<string | null> {
  if (!folderPickerSupported()) return null;
  try {
    const handle = (await window.showDirectoryPicker!({
      id: "kh-nightly-exports",
      mode: "readwrite",
    })) as StoredHandle;
    await idbSet("dir", handle);
    return handle.name;
  } catch {
    return null;
  }
}

export type WriteResult = "saved" | "no-folder" | "denied";

/** Parses the archive CSV (quoted cells, "" escapes, \n rows) into rows. */
export function parseArchiveCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Builds a real .xlsx workbook from archive CSV text. */
export function csvToXlsx(csv: string, sheetName: string): ArrayBuffer {
  const rows = parseArchiveCsv(csv);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Column widths sized to content so the file opens readable, not squashed.
  const widths = rows[0]?.map((_, colIdx) => ({
    wch: Math.min(
      42,
      Math.max(10, ...rows.slice(0, 200).map((r) => (r[colIdx] ?? "").length + 2)),
    ),
  }));
  if (widths) sheet["!cols"] = widths;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/**
 * Writes a file into the remembered folder. Existing files are never
 * overwritten — a suffix is appended so two runs on one day both survive.
 */
export async function writeFileToFolder(filename: string, data: Blob): Promise<WriteResult> {
  try {
    const handle = await loadFolderHandle();
    if (!handle) return "no-folder";
    if (!(await ensurePermission(handle))) return "denied";

    const suffix = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    const stem = suffix ? filename.slice(0, -suffix.length) : filename;
    let name = filename;
    let exists = true;
    try {
      await handle.getFileHandle(name);
    } catch {
      exists = false;
    }
    if (exists) {
      const stamp = new Date()
        .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" })
        .replace(":", "");
      name = `${stem}-${stamp}${suffix}`;
    }

    const fileHandle = await handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return "saved";
  } catch {
    return "denied";
  }
}

export function triggerDownload(filename: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Converts an archive payload to a named .xlsx download + folder write pair. */
export function buildXlsxFile(kind: "visits" | "payments", day: string, csv: string): { name: string; data: Blob } {
  const buffer = csvToXlsx(csv, kind === "visits" ? "Visits" : "Payments");
  return {
    name: `kijabe-${kind}-${day}.xlsx`,
    data: new Blob([buffer], { type: XLSX_MIME }),
  };
}
