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

/** Recording time from metadata, or null when absent/zero. Reads head + tail only. */
export async function getCreationTime(file: Blob): Promise<Date | null> {
  const head = new Uint8Array(
    await file.slice(0, Math.min(WINDOW_BYTES, file.size)).arrayBuffer(),
  );
  let creation = findMvhd(head);
  if (creation === null && file.size > WINDOW_BYTES) {
    const tail = new Uint8Array(
      await file.slice(file.size - WINDOW_BYTES, file.size).arrayBuffer(),
    );
    creation = findMvhd(tail);
  }
  if (creation === null || creation === 0) return null;
  return new Date(Date.UTC(1904, 0, 1) + creation * 1000);
}
