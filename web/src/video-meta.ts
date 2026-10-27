/** Reads the mvhd creation_time of MP4/MOV files (base 1904-01-01). */

const WINDOW_BYTES = 1024 * 1024;

// ponytail: naive byte scan for the first 'mvhd' with version 0/1 (ceiling: a pathological
// file could match the tag inside media data; upgrade to a full box walk if misreads appear).
function findMvhd(buf: Uint8Array): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i + 20 < buf.length; i++) {
    if (buf[i] === 0x6d && buf[i + 1] === 0x76 && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
      const version = buf[i + 4];
      if (version === 1) {
        return Number((BigInt(view.getUint32(i + 8)) << 32n) | BigInt(view.getUint32(i + 12)));
      }
      if (version === 0) return view.getUint32(i + 8);
    }
  }
  return null;
}

async function scanWindows<T>(
  file: Blob,
  scan: (buf: Uint8Array) => T | null,
): Promise<T | null> {
  const head = new Uint8Array(
    await file.slice(0, Math.min(WINDOW_BYTES, file.size)).arrayBuffer(),
  );
  const first = scan(head);
  if (first !== null || file.size <= WINDOW_BYTES) return first;
  const tail = new Uint8Array(
    await file.slice(file.size - WINDOW_BYTES, file.size).arrayBuffer(),
  );
  return scan(tail);
}

/** Recording time from metadata, or null when absent/zero. Reads head + tail only. */
export async function getCreationTime(file: Blob): Promise<Date | null> {
  const creation = await scanWindows(file, findMvhd);
  if (creation === null || creation === 0) return null;
  return new Date(Date.UTC(1904, 0, 1) + creation * 1000);
}

/** Wall-clock reading plus its embedded offset, when the file declares one. */
export interface CreationDateInfo {
  /** Wall reading as UTC ms (mvhd-style baseline). */
  wallMs: number;
  /** Embedded offset in minutes east of UTC. */
  offsetMin: number;
}

const CREATIONDATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})$/;

function findCreationDate(buf: Uint8Array): CreationDateInfo | null {
  const key = [
    0x63, 0x72, 0x65, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x64, 0x61, 0x74, 0x65,
  ]; // 'creationdate'
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let from = 0;
  while (from + key.length < buf.length) {
    let at = -1;
    for (let i = from; i + key.length <= buf.length; i++) {
      let match = true;
      for (let k = 0; k < key.length; k++) {
        if (buf[i + k] !== key[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        at = i;
        break;
      }
    }
    if (at < 0) return null;
    // 'data' box shortly after: size(4) 'data'(4) type(4) locale(4) payload.
    for (let j = at; j + 8 < Math.min(at + 256, buf.length); j++) {
      if (
        buf[j] === 0x64 &&
        buf[j + 1] === 0x61 &&
        buf[j + 2] === 0x74 &&
        buf[j + 3] === 0x61
      ) {
        const boxStart = j - 4;
        const size = boxStart >= 0 ? view.getUint32(boxStart) : 0;
        if (
          size >= 17 &&
          boxStart + size <= buf.length &&
          view.getUint32(j + 4) === 1
        ) {
          const raw = new TextDecoder('utf-8')
            .decode(buf.subarray(j + 12, boxStart + size))
            .replace(/\0/g, '')
            .trim();
          const m = raw.match(CREATIONDATE_RE);
          if (m) {
            const wallMs = Date.UTC(
              Number(m[1]),
              Number(m[2]) - 1,
              Number(m[3]),
              Number(m[4]),
              Number(m[5]),
              Number(m[6]),
            );
            let offsetMin = 0;
            if (m[7] !== 'Z') {
              const sign = m[7][0] === '-' ? -1 : 1;
              const digits = m[7].slice(1).replace(':', '');
              offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
            }
            return { wallMs, offsetMin };
          }
        }
      }
    }
    from = at + 1;
  }
  return null;
}

/** Apple creationdate (wall + embedded offset), or null when absent/invalid. Reads head + tail only. */
export async function getCreationDate(file: Blob): Promise<CreationDateInfo | null> {
  return scanWindows(file, findCreationDate);
}

/** How to interpret a file wall reading: fixed UTC offset in hours. */
export type VideoZone = number;

/** Absolute recording instant from a file wall reading under a zone choice. */
export function resolveVideoInstant(wallMs: number, tz: VideoZone): number {
  return wallMs - tz * 3600e3;
}
