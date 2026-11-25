const CACHE_NAME = 'kvit-cache-v1.4';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Čistý generátor validního PNG (RGBA -> nekomprimovaný DEFLATE PNG) pro ikony PWA bez nutnosti externích souborů
function createPngBuffer(size) {
  const width = size;
  const height = size;
  const rowSize = 1 + width * 4;
  const raw = new Uint8Array(rowSize * height);

  const cx = width / 2;
  const cy = height / 2;
  const cornerR = Math.round(size * 0.22);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filtr: None

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;

      // Zaoblený čtverec pozadí (#6c42c4)
      let inside = true;
      if (x < cornerR && y < cornerR) {
        inside = Math.hypot(x - cornerR, y - cornerR) <= cornerR;
      } else if (x >= width - cornerR && y < cornerR) {
        inside = Math.hypot(x - (width - cornerR - 1), y - cornerR) <= cornerR;
      } else if (x < cornerR && y >= height - cornerR) {
        inside = Math.hypot(x - cornerR, y - (height - cornerR - 1)) <= cornerR;
      } else if (x >= width - cornerR && y >= height - cornerR) {
        inside = Math.hypot(x - (width - cornerR - 1), y - (height - cornerR - 1)) <= cornerR;
      }

      if (!inside) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      // Výchozí fialová barva Kvit (#6c42c4)
      let r = 108, g = 66, b = 196, a = 255;

      // Bílý středový kroužek a symbol vyrovnání (dvě protisměrné šipky / "K")
      const dist = Math.hypot(x - cx, y - cy);
      const outerRing = size * 0.31;
      const innerRing = size * 0.25;

      if (dist <= outerRing && dist >= innerRing) {
        r = 255; g = 255; b = 255;
      } else if (dist < innerRing) {
        // Svislý dřík písmene K vlevo od středu
        const stemLeft = cx - size * 0.11;
        const stemRight = cx - size * 0.055;
        const topY = cy - size * 0.13;
        const botY = cy + size * 0.13;

        const inStem = (x >= stemLeft && x <= stemRight && y >= topY && y <= botY);

        // Horní a dolní rameno K
        const dx = x - stemRight;
        const dy = Math.abs(y - cy);
        const inArm = (dx >= 0 && dx <= size * 0.14 && Math.abs(dy - dx * 0.92) <= size * 0.032);

        if (inStem || inArm) {
          r = 255; g = 255; b = 255;
        }
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  // Adler-32 kontrolní součet
  let s1 = 1, s2 = 0;
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;

  // Zabalení do nekomprimovaných DEFLATE bloků (max 65535 B na blok)
  const maxBlock = 65535;
  const numBlocks = Math.ceil(raw.length / maxBlock);
  const zlibLen = 2 + raw.length + numBlocks * 5 + 4;
  const zlibData = new Uint8Array(zlibLen);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;

  let pos = 2;
  let offset = 0;
  while (offset < raw.length) {
    const len = Math.min(maxBlock, raw.length - offset);
    const isFinal = (offset + len >= raw.length) ? 1 : 0;
    zlibData[pos++] = isFinal;
    zlibData[pos++] = len & 0xff;
    zlibData[pos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    zlibData[pos++] = nlen & 0xff;
    zlibData[pos++] = (nlen >>> 8) & 0xff;
    zlibData.set(raw.subarray(offset, offset + len), pos);
    pos += len;
    offset += len;
  }

  zlibData[pos++] = (adler >>> 24) & 0xff;
  zlibData[pos++] = (adler >>> 16) & 0xff;
  zlibData[pos++] = (adler >>> 8) & 0xff;
  zlibData[pos++] = adler & 0xff;

  // CRC32 tabulka pro PNG chunky
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }

  function makeChunk(typeStr, dataBytes) {
    const chunk = new Uint8Array(12 + dataBytes.length);
    const len = dataBytes.length;
    chunk[0] = (len >>> 24) & 0xff;
    chunk[1] = (len >>> 16) & 0xff;
    chunk[2] = (len >>> 8) & 0xff;
    chunk[3] = len & 0xff;
    for (let i = 0; i < 4; i++) chunk[4 + i] = typeStr.charCodeAt(i);
    chunk.set(dataBytes, 8);

    let crc = 0xffffffff;
    for (let i = 4; i < 8 + len; i++) {
      crc = crcTable[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const end = 8 + len;
    chunk[end] = (crc >>> 24) & 0xff;
    chunk[end + 1] = (crc >>> 16) & 0xff;
    chunk[end + 2] = (crc >>> 8) & 0xff;
    chunk[end + 3] = crc & 0xff;
    return chunk;
  }

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff; ihdr[1] = (width >>> 16) & 0xff; ihdr[2] = (width >>> 8) & 0xff; ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff; ihdr[5] = (height >>> 16) & 0xff; ihdr[6] = (height >>> 8) & 0xff; ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', zlibData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let p = 0;
  png.set(sig, p); p += sig.length;
  png.set(ihdrChunk, p); p += ihdrChunk.length;
  png.set(idatChunk, p); p += idatChunk.length;
  png.set(iendChunk, p);
  return png.buffer;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(CORE_ASSETS.map(url => cache.add(url)));
      // Předgenerování ikon 192x192 a 512x512 do mezipaměti pro okamžitou instalovatelnost PWA
      const icon192 = new Response(createPngBuffer(192), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      });
      const icon512 = new Response(createPngBuffer(512), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      });
      await cache.put('./icon-192.png', icon192);
      await cache.put('./icon-512.png', icon512);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Obsluha ikon PWA (pokud nejsou fyzicky nahrané na serveru, vrátí se vygenerované PNG)