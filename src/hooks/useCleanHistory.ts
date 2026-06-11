import { useState, useCallback } from "react";

export type HistoryEntry = {
  id: string;
  filename: string;
  fileSize: number;
  tagsRemoved: string[];
  date: string;
};

const STORAGE_KEY = "removetag_history";
const MAX_ENTRIES = 50;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // storage quota exceeded or unavailable — silently ignore
  }
}

export function useCleanHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const addEntries = useCallback((entries: Omit<HistoryEntry, "id" | "date">[]) => {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    const newEntries: HistoryEntry[] = entries.map((e) => ({
      ...e,
      id: Math.random().toString(36).substring(2),
      date: now,
    }));
    setHistory((prev) => {
      const updated = [...newEntries, ...prev].slice(0, MAX_ENTRIES);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { history, addEntries, clearHistory };
}
