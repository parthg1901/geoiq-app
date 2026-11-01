/** Backup file: progress saved as JSON (no server). On Android it goes through the share sheet. */
import { useGame } from '../store';
import { isNative } from '../native';
import { todayKey } from '../rng';
import { snapshot, mergeSnapshots, type Snapshot } from './merge';
import { normalize, apply } from './index';

interface BackupFile { app: 'geoiq'; v: 1; at: string; progress: Snapshot }

export async function exportBackup() {
  const file: BackupFile = { app: 'geoiq', v: 1, at: new Date().toISOString(), progress: snapshot(useGame.getState()) };
  const name = `geoiq-backup-${todayKey()}.json`;
  const text = JSON.stringify(file);
  if (isNative) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'GeoIQ backup', files: [uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Read a backup file; throws a friendly message if it isn't one. */
export async function readBackup(f: File): Promise<{ at: string; progress: Snapshot }> {
  let j: Partial<BackupFile>;
  try { j = JSON.parse(await f.text()); } catch { throw new Error('That file isn’t a GeoIQ backup.'); }
  if (j?.app !== 'geoiq' || !j.progress || typeof j.progress !== 'object') throw new Error('That file isn’t a GeoIQ backup.');
  return { at: j.at ?? '', progress: normalize(j.progress) };
}

/** 'replace' restores the backup as-is; 'combine' keeps the best of the backup and this phone. */
export function restoreBackup(progress: Snapshot, how: 'replace' | 'combine') {
  apply(how === 'replace' ? progress : mergeSnapshots(null, snapshot(useGame.getState()), progress));
}
