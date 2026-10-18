function readJpegExif(buffer) {
  const view = new DataView(buffer);
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 < view.byteLength) {
      const start = offset + 4;
      if (view.getUint32(start) !== 0x45786966) break;
      const tiff = start + 6;
      const littleEndian = view.getUint16(tiff) === 0x4949;
      const read16 = (position) => view.getUint16(position, littleEndian);
      const read32 = (position) => view.getUint32(position, littleEndian);
      const firstIfd = tiff + read32(tiff + 4);
      const result = { gpsFound: false, deviceModelFound: false, timestampFound: false };
      const readDirectory = (directory) => {
        if (directory + 2 >= view.byteLength) return null;
        const count = read16(directory);
        let gpsOffset = null;
        for (let index = 0; index < count; index += 1) {
          const entry = directory + 2 + index * 12;
          if (entry + 12 > view.byteLength) break;
          const tag = read16(entry);
          if (tag === 0x0110) result.deviceModelFound = true;
          if (tag === 0x0132 || tag === 0x9003) result.timestampFound = true;
          if (tag === 0x8825) gpsOffset = tiff + read32(entry + 8);
        }
        return gpsOffset;
      };
      const gpsOffset = readDirectory(firstIfd);
      if (gpsOffset) {
        result.gpsFound = true;
        readDirectory(gpsOffset);
      }
      return result;
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset += 2 + length;
  }
  return { gpsFound: false, deviceModelFound: false, timestampFound: false };
}

async function readMetadata(file) {
  const report = { exifFound: false, gpsFound: false, deviceModelFound: false, timestampFound: false };
  if (file.type !== "image/jpeg") return report;
  try {
    const bytes = await file.arrayBuffer();
    const view = new DataView(bytes);
    for (let offset = 2; offset + 10 < view.byteLength; offset += 1) {
      if (view.getUint8(offset) === 0xff && view.getUint8(offset + 1) === 0xe1 && view.getUint32(offset + 4) === 0x45786966) {
        report.exifFound = true;
        return Object.assign(report, readJpegExif(bytes));
      }
    }
  } catch {
    report.inspectionFailed = true;
  }
  return report;
}

module.exports = { readMetadata };